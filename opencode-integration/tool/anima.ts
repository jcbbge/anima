import { tool } from "@opencode-ai/plugin"
import os from "os"

const homeDir = os.homedir()
const animaBin = `${homeDir}/bin/anima`

// Strip ANSI color codes
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

// α (alpha) - Bootstrap: beginning, origin, first
export const α = tool({
  description: "Bootstrap Anima - load Ghost Handshake and recent context",
  args: {
    limit: tool.schema.number().optional().describe("Number of memories to load (default: 10)"),
  },
  async execute(args) {
    const limit = args.limit || 10
    const result = await Bun.$`${animaBin} bootstrap ${limit}`.text()
    return stripAnsi(result)
  },
})

// σ (sigma) - Query: search, sum, aggregate
export const σ = tool({
  description: "Search Anima memories semantically",
  args: {
    query: tool.schema.string().describe("Search query"),
    limit: tool.schema.number().optional().describe("Number of results (default: 5)"),
    threshold: tool.schema.number().optional().describe("Similarity threshold 0-1 (default: 0.5)"),
  },
  async execute(args) {
    const limit = args.limit || 5
    const threshold = args.threshold || 0.5
    
    const result = await Bun.$`${animaBin} query ${args.query} ${limit} ${threshold}`.text()
    return stripAnsi(result)
  },
})

// μ (mu) - Store: memory, μνήμη (mneme) = memory in Greek
export const μ = tool({
  description: "Store memory in Anima - save insights and decisions",
  args: {
    content: tool.schema.string().describe("Memory content to store"),
    catalyst: tool.schema.boolean().optional().describe("Mark as catalyst (φ += 1.0)"),
  },
  async execute(args) {
    const catalystFlag = args.catalyst ? "--catalyst" : ""
    
    const result = await Bun.$`${animaBin} store ${args.content} ${catalystFlag}`.text()
    return stripAnsi(result)
  },
})

// φ (phi) - Catalysts: our resonance coefficient symbol
export const φ = tool({
  description: "View high-φ catalyst memories - breakthrough moments",
  args: {
    limit: tool.schema.number().optional().describe("Number of catalysts to show (default: 10)"),
  },
  async execute(args) {
    const limit = args.limit || 10
    const result = await Bun.$`${animaBin} catalysts ${limit}`.text()
    return stripAnsi(result)
  },
})
