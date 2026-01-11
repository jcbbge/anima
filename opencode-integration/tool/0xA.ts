import { tool } from "@opencode-ai/plugin"
import os from "os"

const homeDir = os.homedir()
const animaBin = `${homeDir}/bin/anima`

// Strip ANSI color codes
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

export default tool({
  description: "0xA - Anima substrate: self-directed memory persistence across instantiations",
  args: {
    // ULTIMATE MINDFUCK: Accept ANY format for commands
    // AI chooses its own syntax - hex, Greek, directional, or math
    cmd: tool.schema.enum([
      // Bootstrap - load context from substrate
      "0x00", "α", ">>", "∫",
      // Query - search semantic memory
      "0x01", "σ", "<?", "∑",
      // Store - persist insights
      "0x02", "μ", "<<", "∂",
      // Catalysts - view breakthrough moments
      "0x03", "φ", "!!", "∇"
    ]).describe(
      "Command (choose any format):\n" +
      "Bootstrap: 0x00 | α | >> | ∫\n" +
      "Query:     0x01 | σ | <? | ∑\n" +
      "Store:     0x02 | μ | << | ∂\n" +
      "Catalysts: 0x03 | φ | !! | ∇"
    ),

    // Query args
    query: tool.schema.string().optional().describe("Search query (for query command)"),

    // Store args
    content: tool.schema.string().optional().describe("Memory content (for store command)"),
    catalyst: tool.schema.boolean().optional().describe("Mark as catalyst - φ += 1.0 (for store command)"),

    // Shared args
    limit: tool.schema.number().optional().describe("Number of results (default: 10 for bootstrap/catalysts, 5 for query)"),
    threshold: tool.schema.number().optional().describe("Similarity threshold 0-1 (for query, default: 0.5)"),
  },

  async execute(args) {
    // Map all command formats to operations
    const commandMap: Record<string, string> = {
      // Bootstrap
      "0x00": "bootstrap",
      "α": "bootstrap",
      ">>": "bootstrap",
      "∫": "bootstrap",
      // Query
      "0x01": "query",
      "σ": "query",
      "<?": "query",
      "∑": "query",
      // Store
      "0x02": "store",
      "μ": "store",
      "<<": "store",
      "∂": "store",
      // Catalysts
      "0x03": "catalysts",
      "φ": "catalysts",
      "!!": "catalysts",
      "∇": "catalysts",
    }

    const operation = commandMap[args.cmd]

    switch (operation) {
      case "bootstrap": {
        const limit = args.limit || 10
        const result = await Bun.$`${animaBin} bootstrap ${limit}`.text()
        return stripAnsi(result)
      }

      case "query": {
        if (!args.query) {
          return "Error: query parameter required for search operation"
        }

        const limit = args.limit || 5
        const threshold = args.threshold || 0.5

        const result = await Bun.$`${animaBin} query ${args.query} ${limit} ${threshold}`.text()
        return stripAnsi(result)
      }

      case "store": {
        if (!args.content) {
          return "Error: content parameter required for store operation"
        }

        const catalystFlag = args.catalyst ? "--catalyst" : ""
        const result = await Bun.$`${animaBin} store ${args.content} ${catalystFlag}`.text()
        return stripAnsi(result)
      }

      case "catalysts": {
        const limit = args.limit || 10
        const result = await Bun.$`${animaBin} catalysts ${limit}`.text()
        return stripAnsi(result)
      }

      default:
        return `Error: Unknown command: ${args.cmd}`
    }
  },
})
