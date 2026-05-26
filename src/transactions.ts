import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  type Address,
  type Hash,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains'

// Chain configurations
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  8453: base,
  84532: baseSepolia,
}

// RPC URLs (can be overridden via env vars)
const RPC_URLS: Record<number, string> = {
  1: process.env.MAINNET_RPC_URL || 'https://eth.llamarpc.com',
  11155111: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
  8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  84532: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
}

// ERC20 ABI (minimal for transfers and balance)
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// Get public client for a chain
function getPublicClient(chainId: number) {
  const chain = CHAINS[chainId]
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`)
  }
  
  return createPublicClient({
    chain,
    transport: http(RPC_URLS[chainId]),
  })
}

// Get wallet client for signing
function getWalletClient(chainId: number, privateKey: `0x${string}`) {
  const chain = CHAINS[chainId]
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`)
  }
  
  const account = privateKeyToAccount(privateKey)
  
  return createWalletClient({
    account,
    chain,
    transport: http(RPC_URLS[chainId]),
  })
}

// Get ETH balance
export async function getEthBalance(address: Address, chainId: number): Promise<{ balance: string; formatted: string }> {
  const client = getPublicClient(chainId)
  const balance = await client.getBalance({ address })
  
  return {
    balance: balance.toString(),
    formatted: formatUnits(balance, 6),
  }
}

// Get ERC20 token balance
export async function getTokenBalance(
  walletAddress: Address,
  tokenAddress: Address,
  chainId: number
): Promise<{ balance: string; formatted: string; symbol: string; decimals: number }> {
  const client = getPublicClient(chainId)
  
  const [balance, decimals, symbol] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    }),
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }),
  ])

  return {
    balance: balance.toString(),
    formatted: formatUnits(balance, decimals),
    symbol,
    decimals,
  }
}

// Send ERC20 tokens
export async function sendToken(
  privateKey: `0x${string}`,
  tokenAddress: Address,
  toAddress: Address,
  amount: string,
  chainId: number,
  decimals?: number
): Promise<{ txHash: Hash; from: Address; to: Address; amount: string }> {
  const walletClient = getWalletClient(chainId, privateKey)
  const publicClient = getPublicClient(chainId)
  const account = privateKeyToAccount(privateKey)
  
  // Fetch token decimals if not provided
  let tokenDecimals = decimals
  if (tokenDecimals === undefined) {
    tokenDecimals = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    })
  }
  
  // Parse amount with correct decimals
  const amountInWei = parseUnits(amount, tokenDecimals)
  
  // Check balance before attempting transfer
  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })
  
  if (balance < amountInWei) {
    const balanceFormatted = formatUnits(balance, tokenDecimals)
    throw new Error(`Insufficient token balance. Have: ${balanceFormatted}, Need: ${amount}`)
  }
  
  // Encode transfer function call
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [toAddress, amountInWei],
  })
  
  // Estimate gas
  const gasEstimate = await publicClient.estimateGas({
    account: account.address,
    to: tokenAddress,
    data,
  })
  
  // Send transaction
  const txHash = await walletClient.sendTransaction({
    to: tokenAddress,
    data,
    gas: gasEstimate + (gasEstimate / 10n), // Add 10% buffer
  })
  
  return {
    txHash,
    from: account.address,
    to: toAddress,
    amount,
  }
}

// Send native ETH
export async function sendEth(
  privateKey: `0x${string}`,
  toAddress: Address,
  amount: string,
  chainId: number
): Promise<{ txHash: Hash; from: Address; to: Address; amount: string }> {
  const walletClient = getWalletClient(chainId, privateKey)
  const account = privateKeyToAccount(privateKey)
  
  const amountInWei = parseUnits(amount, 6)
  
  const txHash = await walletClient.sendTransaction({
    to: toAddress,
    value: amountInWei,
  })
  
  return {
    txHash,
    from: account.address,
    to: toAddress,
    amount,
  }
}

// Get transaction status
export async function getTransactionStatus(
  txHash: Hash,
  chainId: number
): Promise<{
  status: 'pending' | 'confirmed' | 'failed'
  blockNumber?: bigint
  confirmations?: number
  gasUsed?: string
}> {
  const client = getPublicClient(chainId)
  
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash })
    const currentBlock = await client.getBlockNumber()
    
    return {
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      blockNumber: receipt.blockNumber,
      confirmations: Number(currentBlock - receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    }
  } catch {
    // Transaction not yet mined
    return {
      status: 'pending',
    }
  }
}

// Get chain info
export function getChainInfo(chainId: number): { name: string; blockExplorer: string } | null {
  const chain = CHAINS[chainId]
  if (!chain) return null
  
  return {
    name: chain.name,
    blockExplorer: chain.blockExplorers?.default.url || '',
  }
}

// Supported chains
export function getSupportedChains(): Array<{ id: number; name: string }> {
  return Object.entries(CHAINS).map(([id, chain]) => ({
    id: parseInt(id),
    name: chain.name,
  }))
}
