import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Bootstrap Anima memory system - loads Ghost Handshake and recent context",
  args: {
    limit: tool.schema.number().optional().describe("Number of memories to load (default: 10)"),
  },
  async execute(args) {
    const limit = args.limit || 10
    
    // Check if Docker services are running
    const dockerCheck = await Bun.$`docker ps | grep anima-postgres`.quiet().nothrow()
    
    if (!dockerCheck.stdout.toString().trim()) {
      // Services not running, start them
      await Bun.$`cd ~/.anima && docker compose up -d`.quiet()
      await Bun.$`sleep 3`
    }
    
    // Run bootstrap
    const result = await Bun.$`$HOME/bin/anima bootstrap ${limit}`.text()
    
    // Return the bootstrap output
    return result
  },
})
