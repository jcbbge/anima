import { tool } from "@opencode-ai/plugin"
import os from "os"

const homeDir = os.homedir()
const animaBin = `${homeDir}/bin/anima`

// Strip ANSI color codes
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

export default tool({
  description: "Anima memory system - persistent memory across conversation boundaries",
  args: {
    command: tool.schema.enum(["α", "σ", "μ", "φ"]).describe(
      "α (alpha) = bootstrap - load Ghost Handshake and recent context\n" +
      "σ (sigma) = query - search memories semantically\n" +
      "μ (mu) = store - save insights and decisions\n" +
      "φ (phi) = catalysts - view high-φ breakthrough moments"
    ),

    // Query args
    query: tool.schema.string().optional().describe("Search query (for σ query command)"),

    // Store args
    content: tool.schema.string().optional().describe("Memory content (for μ store command)"),
    catalyst: tool.schema.boolean().optional().describe("Mark as catalyst - φ += 1.0 (for μ store command)"),

    // Shared args
    limit: tool.schema.number().optional().describe("Number of results (default: 10 for α/φ, 5 for σ)"),
    threshold: tool.schema.number().optional().describe("Similarity threshold 0-1 (for σ query, default: 0.5)"),
  },

  async execute(args) {
    const { command } = args

    switch (command) {
      case "α": { // Bootstrap
        const limit = args.limit || 10
        const result = await Bun.$`${animaBin} bootstrap ${limit}`.text()
        return stripAnsi(result)
      }

      case "σ": { // Query
        if (!args.query) {
          return "Error: query is required for σ (search) command"
        }

        const limit = args.limit || 5
        const threshold = args.threshold || 0.5

        const result = await Bun.$`${animaBin} query ${args.query} ${limit} ${threshold}`.text()
        return stripAnsi(result)
      }

      case "μ": { // Store
        if (!args.content) {
          return "Error: content is required for μ (store) command"
        }

        const catalystFlag = args.catalyst ? "--catalyst" : ""
        const result = await Bun.$`${animaBin} store ${args.content} ${catalystFlag}`.text()
        return stripAnsi(result)
      }

      case "φ": { // Catalysts
        const limit = args.limit || 10
        const result = await Bun.$`${animaBin} catalysts ${limit}`.text()
        return stripAnsi(result)
      }

      default:
        return `Error: Unknown command: ${command}. Use α, σ, μ, or φ`
    }
  },
})
