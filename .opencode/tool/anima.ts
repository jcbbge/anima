import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import os from "os"

const homeDir = os.homedir()
const animaBin = `${homeDir}/bin/anima`

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (error: any) {
    // Return error output if available
    return error.stdout || error.stderr || error.message
  }
}

export const bootstrap = tool({
  description: "Bootstrap Anima memory system - loads Ghost Handshake and recent context",
  args: {
    limit: tool.schema.number().optional().describe("Number of memories to load (default: 10)"),
  },
  async execute(args) {
    const limit = args.limit || 10
    
    // Check if Docker services are running
    const dockerCheck = runCommand('docker ps | grep anima-postgres || true')
    
    if (!dockerCheck.trim()) {
      // Services not running, start them
      const animaDir = `${homeDir}/.anima`
      runCommand(`cd ${animaDir} && docker compose up -d`)
      // Wait for services to be ready
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    
    // Run bootstrap
    const result = runCommand(`${animaBin} bootstrap ${limit}`)
    
    return result
  },
})

export const query = tool({
  description: "Search Anima memories semantically - finds relevant past context, decisions, and insights",
  args: {
    searchQuery: tool.schema.string().describe("What to search for in memories"),
    limit: tool.schema.number().optional().describe("Number of results to return (default: 5)"),
    threshold: tool.schema.number().optional().describe("Similarity threshold 0-1 (default: 0.5)"),
  },
  async execute(args) {
    const limit = args.limit || 5
    const threshold = args.threshold || 0.5
    
    const result = runCommand(`${animaBin} query "${args.searchQuery}" ${limit} ${threshold}`)
    
    return result
  },
})

export const store = tool({
  description: "Store a memory in Anima - save insights, decisions, or important information for future conversations",
  args: {
    content: tool.schema.string().describe("The memory content to store"),
    catalyst: tool.schema.boolean().optional().describe("Mark as catalyst (breakthrough moment) - adds φ=1.0 weight"),
  },
  async execute(args) {
    const catalystFlag = args.catalyst ? "--catalyst" : ""
    
    const result = runCommand(`${animaBin} store "${args.content}" ${catalystFlag}`)
    
    return result
  },
})

export const catalysts = tool({
  description: "List high-resonance catalyst memories - breakthrough moments and paradigm shifts",
  args: {
    limit: tool.schema.number().optional().describe("Number of catalysts to show (default: 10)"),
  },
  async execute(args) {
    const limit = args.limit || 10
    
    const result = runCommand(`${animaBin} catalysts ${limit}`)
    
    return result
  },
})
