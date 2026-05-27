# Metamask for Agents!

A local MCP (Model Context Protocol) server that enables AI agents like Claude to securely manage crypto wallets and send payments. **Private keys never leave your machine.**

## 🔐 Security Model

- Private keys are encrypted with AES-256-GCM using scrypt key derivation
- Keys are stored locally in `~/.wallet-mcp/keystore/`
- Runs via stdio transport (local process, no network exposure)
- Claude can sign transactions but never sees the raw private key

## 🚀 Installation

```bash
# Clone or install
git clone <repo-url>
cd wallet-mcp
npm install
npm run build
```

## 📋 Claude Desktop Configuration

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) (Or just do it like Windows for more GUI friendly approach): 

```json
{
  "mcpServers": {
    "wallet-mcp": {
      "command": "node",
      "args": ["/path/to/wallet-mcp/dist/index.js"],
      "env": {
        "WALLET_MCP_PASSWORD": "your-secure-password"
      }
    }
  }
}
```

On Windows, the path for `claude_desktop_config.json` is a bit weird, so directly open the config via **Claude Desktop → Settings → Developer → Edit Config** and add the same server entry, using a Windows-style path:

```json
{
  "mcpServers": {
    "wallet-mcp": {
      "command": "node",
      "args": ["C:\\path\\to\\wallet-mcp\\dist\\index.js"],
      "env": {
        "WALLET_MCP_PASSWORD": "your-secure-password"
      }
    }
  }
}
```

If you are using WSL, point Claude to `wsl.exe` and use the Linux path inside WSL:

```json
{
  "mcpServers": {
    "wallet-mcp": {
      "command": "C:\\Windows\\System32\\wsl.exe",
      "args": ["~/.nvm/versions/node/v24.16.0/bin/node", "~/wallet-mcp/dist/index.js"],
      "env": {
        "WALLET_MCP_PASSWORD": "your-secure-password"
      }
    }
  }
}
```

> If the repo is on your C: drive and mounted in WSL, use `"args": ["node", "/mnt/c/path/to/wallet-mcp/dist/index.js"]` instead.

> Note: In WSL setups, ensure `wsl.exe` is available in your Windows PATH.

### Configuration Options

| Env Variable | Description |
|--------------|-------------|
| `WALLET_MCP_PASSWORD` | Default password for wallet operations (optional, can be passed per-request) |
| `BASE_SEPOLIA_RPC_URL` | Custom RPC URL for Base Sepolia (default: public RPC) |
| `MAINNET_RPC_URL` | Custom RPC URL for Ethereum mainnet |

## 🛠️ Available Tools

### `create_wallet`
Create a new Ethereum wallet with encrypted storage.

### `import_wallet`
Import an existing private key (encrypted locally).

### `list_wallets`
Show all wallet addresses stored on your machine.

### `get_balance`
Check ETH or ERC20 token balance for any address.

### `send_token`
**The main payment tool!** Signs and sends ERC20 token transfers.
- Supports Base Sepolia (84532), Base (8453), Ethereum (1), Sepolia (11155111)
- Transaction is signed locally, then broadcast

### `get_transaction`
Check the status and confirmations of a transaction.

## 💡 Example Usage with Claude

```
User: "Buy the API Access product from the shop"

Claude → Shop MCP: get_payment_info("api-access")
         Returns: {amount: "10", token: "0x...", receiver: "0x...", chainId: 84532}

Claude → Wallet MCP: list_wallets()
         Returns: ["0xYourWallet..."]

Claude → Wallet MCP: get_balance({walletAddress: "0xYourWallet", tokenAddress: "0x..."})
         Returns: "Balance: 50 USDC"

Claude → Wallet MCP: send_token({
           fromAddress: "0xYourWallet",
           toAddress: "0xReceiverAddress",
           tokenAddress: "0xTokenAddress",
           amount: "10",
           chainId: 84532
         })
         Returns: {txHash: "0x...", status: "sent"}

Claude → Shop MCP: submit_payment("api-access", "0xTxHash", "0xYourWallet")
         Returns: "✅ Payment verified! You now have access!"
```

## 🔧 Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Test manually (sends JSON-RPC via stdin)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

## 📁 File Structure

```
~/.wallet-mcp/
└── keystore/
    ├── 0xabc123...def.json   # Encrypted wallet 1
    └── 0x789xyz...456.json   # Encrypted wallet 2
```

Each keystore file contains:
- Address (public)
- Encrypted private key (AES-256-GCM)
- Scrypt KDF parameters
- Creation timestamp

## ⚠️ Security Notes

1. **Backup your keystore directory** - losing it means losing access to your wallets
2. **Use a strong password** - this encrypts your private keys
3. **Never share your keystore files** - even encrypted, treat them as sensitive
4. **Test with testnets first** - Base Sepolia is the default chain

## 📜 License

MIT
