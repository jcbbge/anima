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
    command: tool.schema.enum(["bootstrap", "query", "store", "catalysts"]).describe(
      "Command: bootstrap (load context), query (search), store (save), catalysts (view breakthroughs)"
    ),
    searchQuery: tool.schema.string().optional().describe("Search query (for query)"),
    content: tool.schema.string().optional().describe("Memory content (for store)"),
    catalyst: tool.schema.boolean().optional().describe("Mark as catalyst (for store)"),
    limit: tool.schema.number().optional().describe("Number of results"),
    threshold: tool.schema.number().optional().describe("Similarity threshold 0-1 (for query)"),
  },
  async execute(args) {
    const { command } = args
    
    try {
      switch (command) {
        case "bootstrap": {
          const limit = args.limit || 10
          const result = await Bun.$`${animaBin} bootstrap ${limit}`.text()
          return stripAnsi(result)
        }
        
        case "query": {
          if (!args.searchQuery) return "Error: searchQuery required"
          const limit = args.limit || 5
          const threshold = args.threshold || 0.5
          
          const result = await Bun.$`${animaBin} query ${args.searchQuery} ${limit} ${threshold}`.text()
          return stripAnsi(result)
        }
        
        case "store": {
          if (!args.content) return "Error: content required"
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
          return `Unknown command: ${command}`
      }
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
})
