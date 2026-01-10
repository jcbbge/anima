import { tool } from "@opencode-ai/plugin"
import os from "os"

const homeDir = os.homedir()
const animaBin = `${homeDir}/bin/anima`

// Check which location Anima is installed at
function getAnimaDir(): string {
  const hiddenPath = `${homeDir}/.anima`
  const visiblePath = `${homeDir}/anima`
  
  // Check if .anima exists first (install script default)
  try {
    const fs = require('fs')
    if (fs.existsSync(hiddenPath)) {
      return hiddenPath
    }
  } catch {}
  
  // Fall back to ~/anima (dev install)
  return visiblePath
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
    try {
      const { command } = args
      
      switch (command) {
        case "bootstrap": {
          const limit = args.limit || 10
          
          // Check Docker
          try {
            const dockerCheck = await Bun.$`docker ps | grep anima-postgres`.quiet().nothrow()
            
            if (!dockerCheck.stdout.toString().trim()) {
              // Start services
              const animaDir = getAnimaDir()
              await Bun.$`cd ${animaDir} && docker compose up -d`.quiet()
              await Bun.$`sleep 3`
            }
          } catch (dockerError: any) {
            return `Docker check failed: ${dockerError.message}`
          }
          
          // Run bootstrap
          const result = await Bun.$`${animaBin} bootstrap ${limit}`.text()
          return result
        }
        
        case "query": {
          if (!args.searchQuery) return "Error: searchQuery required"
          const limit = args.limit || 5
          const threshold = args.threshold || 0.5
          
          const result = await Bun.$`${animaBin} query ${args.searchQuery} ${limit} ${threshold}`.text()
          return result
        }
        
        case "store": {
          if (!args.content) return "Error: content required"
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
          return `Unknown command: ${command}`
      }
    } catch (error: any) {
      return `Tool error: ${error.message}\nCommand: ${args.command}`
    }
  },
})
