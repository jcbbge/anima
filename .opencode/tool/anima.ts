import { tool } from "@opencode-ai/plugin"
import os from "os"

const homeDir = os.homedir()
const animaBin = `${homeDir}/bin/anima`

export default tool({
  description: "Anima memory system - persistent memory across conversation boundaries",
  args: {
    command: tool.schema.enum(["bootstrap", "query", "store", "catalysts"]).describe(
      "Command to execute: bootstrap (load context), query (search), store (save), catalysts (view breakthroughs)"
    ),
    // Query args
    searchQuery: tool.schema.string().optional().describe("Search query (for query command)"),
    // Store args
    content: tool.schema.string().optional().describe("Memory content (for store command)"),
    catalyst: tool.schema.boolean().optional().describe("Mark as catalyst/breakthrough (for store command)"),
    // Shared args
    limit: tool.schema.number().optional().describe("Number of results (default: 10 for bootstrap/catalysts, 5 for query)"),
    threshold: tool.schema.number().optional().describe("Similarity threshold 0-1 (for query, default: 0.5)"),
  },
  async execute(args) {
    const { command } = args
    
    switch (command) {
      case "bootstrap": {
        const limit = args.limit || 10
        
        // Check if Docker services are running
        const dockerCheck = await Bun.$`docker ps | grep anima-postgres`.quiet().nothrow()
        
        if (!dockerCheck.stdout.toString().trim()) {
          // Services not running, start them
          const animaDir = `${homeDir}/.anima`
          await Bun.$`cd ${animaDir} && docker compose up -d`.quiet()
          await Bun.$`sleep 3`
        }
        
        // Run bootstrap
        const result = await Bun.$`${animaBin} bootstrap ${limit}`.text()
        return result
      }
      
      case "query": {
        if (!args.searchQuery) {
          return "Error: searchQuery is required for query command"
        }
        
        const limit = args.limit || 5
        const threshold = args.threshold || 0.5
        
        const result = await Bun.$`${animaBin} query ${args.searchQuery} ${limit} ${threshold}`.text()
        return result
      }
      
      case "store": {
        if (!args.content) {
          return "Error: content is required for store command"
        }
        
        const catalystFlag = args.catalyst ? "--catalyst" : ""
        const result = await Bun.$`${animaBin} store ${args.content} ${catalystFlag}`.text()
        return result
      }
      
      case "catalysts": {
        const limit = args.limit || 10
        const result = await Bun.$`${animaBin} catalysts ${limit}`.text()
        return result
      }
      
      default:
        return `Error: Unknown command: ${command}`
    }
  },
})
