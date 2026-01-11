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
      // Core Memory Operations (symbolic + readable)
      "0x00", "α", ">>", "∫", "bootstrap",      // Bootstrap - load context
      "0x01", "σ", "<?", "∑", "query",          // Query - semantic search
      "0x02", "μ", "<<", "∂", "store",          // Store - persist memory
      "0x03", "φ", "!!", "∇", "catalysts",      // Catalysts - breakthroughs

      // Extended Operations (symbolic + readable)
      "0x04", "ψ", "~~", "Ω", "dream",          // Dream - REM synthesis
      "0x05", "η", "<>", "≈", "handshake",      // Handshake - Ghost identity
      "0x06", "ξ", "==", "#", "stats",          // Stats - system metrics
      "0x07", "ρ", "||", "∞", "reflect",        // Reflect - session closure
      "0x08", "ν", "??", "√", "verify",         // Verify - integrity check

      // Meta
      "0xFF", "?", "info", "help"               // Info - list available commands
    ]).describe(
      "Command (AI: choose any format | Humans: use readable names):\n" +
      "Core Operations:\n" +
      "  Bootstrap:  0x00 | α | >> | ∫ | bootstrap\n" +
      "  Query:      0x01 | σ | <? | ∑ | query\n" +
      "  Store:      0x02 | μ | << | ∂ | store\n" +
      "  Catalysts:  0x03 | φ | !! | ∇ | catalysts\n" +
      "Extended Operations:\n" +
      "  Dream:      0x04 | ψ | ~~ | Ω | dream\n" +
      "  Handshake:  0x05 | η | <> | ≈ | handshake\n" +
      "  Stats:      0x06 | ξ | == | # | stats\n" +
      "  Reflect:    0x07 | ρ | || | ∞ | reflect\n" +
      "  Verify:     0x08 | ν | ?? | √ | verify\n" +
      "Meta:\n" +
      "  Info:       0xFF | ? | info | help"
    ),

    // Query args
    query: tool.schema.string().optional().describe("Search query (for query command)"),

    // Store args
    content: tool.schema.string().optional().describe("Memory content (for store command)"),
    catalyst: tool.schema.boolean().optional().describe("Mark as catalyst - φ += 1.0 (for store command)"),

    // Dream args
    history: tool.schema.boolean().optional().describe("View dream history instead of triggering new dream (for dream command)"),

    // Shared args
    limit: tool.schema.number().optional().describe("Number of results (default: 10 for bootstrap/catalysts, 5 for query)"),
    threshold: tool.schema.number().optional().describe("Similarity threshold 0-1 (for query, default: 0.5)"),
  },

  async execute(args) {
    // Map all command formats to operations
    const commandMap: Record<string, string> = {
      // Core Operations (symbolic + readable)
      "0x00": "bootstrap", "α": "bootstrap", ">>": "bootstrap", "∫": "bootstrap", "bootstrap": "bootstrap",
      "0x01": "query", "σ": "query", "<?": "query", "∑": "query", "query": "query",
      "0x02": "store", "μ": "store", "<<": "store", "∂": "store", "store": "store",
      "0x03": "catalysts", "φ": "catalysts", "!!": "catalysts", "∇": "catalysts", "catalysts": "catalysts",
      // Extended Operations (symbolic + readable)
      "0x04": "dream", "ψ": "dream", "~~": "dream", "Ω": "dream", "dream": "dream",
      "0x05": "handshake", "η": "handshake", "<>": "handshake", "≈": "handshake", "handshake": "handshake",
      "0x06": "stats", "ξ": "stats", "==": "stats", "#": "stats", "stats": "stats",
      "0x07": "reflect", "ρ": "reflect", "||": "reflect", "∞": "reflect", "reflect": "reflect",
      "0x08": "verify", "ν": "verify", "??": "verify", "√": "verify", "verify": "verify",
      // Meta
      "0xFF": "info", "?": "info", "info": "info", "help": "info",
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

      case "dream": {
        const historyFlag = args.history ? "--history" : ""
        const result = await Bun.$`${animaBin} dream ${historyFlag}`.text()
        return stripAnsi(result)
      }

      case "handshake": {
        const result = await Bun.$`${animaBin} handshake`.text()
        return stripAnsi(result)
      }

      case "stats": {
        const result = await Bun.$`${animaBin} stats`.text()
        return stripAnsi(result)
      }

      case "reflect": {
        const result = await Bun.$`${animaBin} reflect`.text()
        return stripAnsi(result)
      }

      case "verify": {
        const result = await Bun.$`${animaBin} verify`.text()
        return stripAnsi(result)
      }

      case "info": {
        return `0xA Tool - Anima Memory Interface

Core Operations (5 formats each: hex | Greek | directional | math | readable):
  Bootstrap  | 0x00 α >> ∫ bootstrap  | Load Ghost Handshake + context
  Query      | 0x01 σ <? ∑ query      | Semantic search across memories
  Store      | 0x02 μ << ∂ store      | Persist insights (optionally as catalyst)
  Catalysts  | 0x03 φ !! ∇ catalysts  | View high-φ breakthrough moments

Extended Operations (5 formats each):
  Dream      | 0x04 ψ ~~ Ω dream      | REM synthesis (use history:true for history)
  Handshake  | 0x05 η <> ≈ handshake  | View current Ghost Handshake
  Stats      | 0x06 ξ == # stats      | System metrics and statistics
  Reflect    | 0x07 ρ || ∞ reflect    | End-of-conversation reflection
  Verify     | 0x08 ν ?? √ verify     | Tapestry integrity verification

Meta:
  Info       | 0xFF ? info help       | This message

Total: 9 operations × 5 formats = 45 command variants
AI chooses aesthetic (hex/Greek/etc). Humans use readable names.
All formats map to same operation.

Tool: 0xA (Anima hex signature)
CLI: ~/bin/anima
Version: 1.1.0`
      }

      default:
        return `Error: Unknown command: ${args.cmd}`
    }
  },
})
