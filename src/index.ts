#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { Address, Hash } from 'viem'

import { logger, getLogFile } from './logger.js'
import { createWallet, importWallet, listWallets, unlockWallet, getWalletDir } from './wallet.js'
import {
  getEthBalance,
  getTokenBalance,
  sendToken,
  getTransactionStatus,
  getChainInfo,
  getSupportedChains,
} from './transactions.js'

// Default password from environment (user can set this)
const DEFAULT_PASSWORD = process.env.WALLET_MCP_PASSWORD || ''

// Tool definitions
const TOOLS = [
  {
    name: 'create_wallet',
    description: 'Create a new Ethereum wallet. The private key is encrypted and stored locally on your machine. Returns the new wallet address.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        password: {
          type: 'string',
          description: 'Password to encrypt the wallet. If not provided, uses WALLET_MCP_PASSWORD env var.',
        },
      },
      required: [],
    },
  },
  {
    name: 'import_wallet',
    description: 'Import an existing wallet using a private key. The key is encrypted and stored locally.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        privateKey: {
          type: 'string',
          description: 'The private key to import (with or without 0x prefix)',
        },
        password: {
          type: 'string',
          description: 'Password to encrypt the wallet. If not provided, uses WALLET_MCP_PASSWORD env var.',
        },
      },
      required: ['privateKey'],
    },
  },
  {
    name: 'list_wallets',
    description: 'List all wallet addresses stored locally on this machine.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_balance',
    description: 'Get the ETH and/or token balance for a wallet address.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        walletAddress: {
          type: 'string',
          description: 'The wallet address to check balance for (0x...)',
        },
        tokenAddress: {
          type: 'string',
          description: 'Optional: ERC20 token contract address. If omitted, returns ETH balance.',
        },
        chainId: {
          type: 'number',
          description: 'Chain ID (default: 84532 for Base Sepolia). Supported: 1 (Mainnet), 11155111 (Sepolia), 8453 (Base), 84532 (Base Sepolia)',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'send_token',
    description: 'Send ERC20 tokens to make a payment. Use this to pay for products/services when you receive payment details (amount, tokenAddress, receiverAddress, chainId). Signs locally - private key never leaves your machine. Returns txHash to submit as proof of payment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromAddress: {
          type: 'string',
          description: 'Your wallet address that will send the tokens (must be stored locally)',
        },
        toAddress: {
          type: 'string',
          description: 'Recipient/receiver address to pay',
        },
        tokenAddress: {
          type: 'string',
          description: 'ERC20 token contract address',
        },
        amount: {
          type: 'string',
          description: 'Amount to send in token units (e.g., "10" for 10 tokens)',
        },
        chainId: {
          type: 'number',
          description: 'Chain ID (default: 84532 for Base Sepolia)',
        },
        decimals: {
          type: 'number',
          description: 'Token decimals (default: 6)',
        },
        password: {
          type: 'string',
          description: 'Password to unlock the wallet. If not provided, uses WALLET_MCP_PASSWORD env var.',
        },
      },
      required: ['fromAddress', 'toAddress', 'tokenAddress', 'amount'],
    },
  },
  {
    name: 'get_transaction',
    description: 'Check the status of a transaction by its hash.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        txHash: {
          type: 'string',
          description: 'Transaction hash (0x...)',
        },
        chainId: {
          type: 'number',
          description: 'Chain ID (default: 84532 for Base Sepolia)',
        },
      },
      required: ['txHash'],
    },
  },
]

// Create MCP server
const server = new Server(
  {
    name: 'wallet-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS }
})

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  
  // Log tool call
  logger.tool(name, args)

  try {
    switch (name) {
      case 'create_wallet': {
        const password = (args?.password as string) || DEFAULT_PASSWORD
        if (!password) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Password required. Either provide it as an argument or set WALLET_MCP_PASSWORD environment variable.',
              },
            ],
            isError: true,
          }
        }

        const result = await createWallet(password)
        return {
          content: [
            {
              type: 'text',
              text: `✅ Wallet created!\n\n**Address:** \`${result.address}\`\n\n${result.message}\n\n⚠️ Remember your password - it's needed to sign transactions.`,
            },
          ],
        }
      }

      case 'import_wallet': {
        const privateKey = args?.privateKey as string
        const password = (args?.password as string) || DEFAULT_PASSWORD
        
        if (!privateKey) {
          return {
            content: [{ type: 'text', text: '❌ Private key is required.' }],
            isError: true,
          }
        }
        
        if (!password) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Password required. Either provide it as an argument or set WALLET_MCP_PASSWORD environment variable.',
              },
            ],
            isError: true,
          }
        }

        const result = await importWallet(privateKey, password)
        return {
          content: [
            {
              type: 'text',
              text: `✅ Wallet imported!\n\n**Address:** \`${result.address}\`\n\n${result.message}`,
            },
          ],
        }
      }

      case 'list_wallets': {
        const result = await listWallets()
        
        if (result.wallets.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No wallets found.\n\nWallet directory: \`${getWalletDir()}\`\n\nUse \`create_wallet\` or \`import_wallet\` to add one.`,
              },
            ],
          }
        }

        const walletList = result.wallets.map((w, i) => `${i + 1}. \`${w}\``).join('\n')
        return {
          content: [
            {
              type: 'text',
              text: `# Local Wallets\n\n${walletList}\n\n---\nStored in: \`${getWalletDir()}\``,
            },
          ],
        }
      }

      case 'get_balance': {
        const walletAddress = args?.walletAddress as Address
        const tokenAddress = args?.tokenAddress as Address | undefined
        const chainId = (args?.chainId as number) || 84532

        if (!walletAddress?.startsWith('0x')) {
          return {
            content: [{ type: 'text', text: '❌ Invalid wallet address. Must start with 0x.' }],
            isError: true,
          }
        }

        const chainInfo = getChainInfo(chainId)
        if (!chainInfo) {
          const supported = getSupportedChains().map(c => `${c.id} (${c.name})`).join(', ')
          return {
            content: [{ type: 'text', text: `❌ Unsupported chain ID: ${chainId}. Supported: ${supported}` }],
            isError: true,
          }
        }

        if (tokenAddress) {
          const balance = await getTokenBalance(walletAddress, tokenAddress, chainId)
          return {
            content: [
              {
                type: 'text',
                text: `# Token Balance\n\n**Wallet:** \`${walletAddress}\`\n**Chain:** ${chainInfo.name}\n**Token:** ${balance.symbol}\n\n**Balance:** ${balance.formatted} ${balance.symbol}`,
              },
            ],
          }
        } else {
          const balance = await getEthBalance(walletAddress, chainId)
          return {
            content: [
              {
                type: 'text',
                text: `# ETH Balance\n\n**Wallet:** \`${walletAddress}\`\n**Chain:** ${chainInfo.name}\n\n**Balance:** ${balance.formatted} ETH`,
              },
            ],
          }
        }
      }

      case 'send_token': {
        const fromAddress = args?.fromAddress as Address
        const toAddress = args?.toAddress as Address
        const tokenAddress = args?.tokenAddress as Address
        const amount = args?.amount as string
        const chainId = (args?.chainId as number) || 84532
        const decimals = (args?.decimals as number) || 6
        const password = (args?.password as string) || DEFAULT_PASSWORD

        if (!fromAddress?.startsWith('0x')) {
          return {
            content: [{ type: 'text', text: '❌ Invalid fromAddress. Must start with 0x.' }],
            isError: true,
          }
        }

        if (!toAddress?.startsWith('0x')) {
          return {
            content: [{ type: 'text', text: '❌ Invalid toAddress. Must start with 0x.' }],
            isError: true,
          }
        }

        if (!tokenAddress?.startsWith('0x')) {
          return {
            content: [{ type: 'text', text: '❌ Invalid tokenAddress. Must start with 0x.' }],
            isError: true,
          }
        }

        if (!amount || isNaN(parseFloat(amount))) {
          return {
            content: [{ type: 'text', text: '❌ Invalid amount. Must be a number.' }],
            isError: true,
          }
        }

        if (!password) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Password required to unlock wallet. Either provide it as an argument or set WALLET_MCP_PASSWORD environment variable.',
              },
            ],
            isError: true,
          }
        }

        const chainInfo = getChainInfo(chainId)
        if (!chainInfo) {
          return {
            content: [{ type: 'text', text: `❌ Unsupported chain ID: ${chainId}` }],
            isError: true,
          }
        }

        // Unlock wallet and get private key
        const privateKey = unlockWallet(fromAddress, password)

        // Send the transaction
        const result = await sendToken(privateKey, tokenAddress, toAddress, amount, chainId, decimals)

        return {
          content: [
            {
              type: 'text',
              text: `# ✅ Transaction Sent!\n\n**From:** \`${result.from}\`\n**To:** \`${result.to}\`\n**Amount:** ${result.amount} tokens\n**Chain:** ${chainInfo.name}\n\n**Transaction Hash:** \`${result.txHash}\`\n\n🔗 [View on Explorer](${chainInfo.blockExplorer}/tx/${result.txHash})\n\n⏳ Use \`get_transaction\` to check confirmation status.`,
            },
          ],
        }
      }

      case 'get_transaction': {
        const txHash = args?.txHash as Hash
        const chainId = (args?.chainId as number) || 84532

        if (!txHash?.startsWith('0x')) {
          return {
            content: [{ type: 'text', text: '❌ Invalid transaction hash. Must start with 0x.' }],
            isError: true,
          }
        }

        const chainInfo = getChainInfo(chainId)
        if (!chainInfo) {
          return {
            content: [{ type: 'text', text: `❌ Unsupported chain ID: ${chainId}` }],
            isError: true,
          }
        }

        const status = await getTransactionStatus(txHash, chainId)

        const statusEmoji = status.status === 'confirmed' ? '✅' : status.status === 'failed' ? '❌' : '⏳'
        
        let details = `# ${statusEmoji} Transaction Status\n\n**Hash:** \`${txHash}\`\n**Chain:** ${chainInfo.name}\n**Status:** ${status.status.toUpperCase()}`

        if (status.blockNumber !== undefined) {
          details += `\n**Block:** ${status.blockNumber}`
        }
        if (status.confirmations !== undefined) {
          details += `\n**Confirmations:** ${status.confirmations}`
        }
        if (status.gasUsed) {
          details += `\n**Gas Used:** ${status.gasUsed}`
        }

        details += `\n\n🔗 [View on Explorer](${chainInfo.blockExplorer}/tx/${txHash})`

        return {
          content: [{ type: 'text', text: details }],
        }
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`Tool ${name} failed`, { error: message, args })
    return {
      content: [{ type: 'text', text: `❌ Error: ${message}` }],
      isError: true,
    }
  }
})

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info('wallet-mcp server started', { logFile: getLogFile() })
  console.error(`wallet-mcp running (logs: ${getLogFile()})`)
}

main().catch((error) => {
  logger.error('Fatal error', error)
  console.error('Fatal error:', error)
  process.exit(1)
})
