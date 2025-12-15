# Claude Usage

A VS Code extension that displays your Claude API usage utilization directly in the status bar. Monitor your Claude usage percentage, reset times, and toggle between "used" and "left" display modes.

## Features

- 📊 **Real-time Usage Display**: Shows Claude API usage percentage in the VS Code status bar
- 🔄 **Auto-refresh**: Automatically refreshes usage data at configurable intervals
- 🔐 **Secure Storage**: Session keys are stored securely using VS Code's secret storage
- 🎨 **Toggle Display**: Switch between "used" and "left" percentage views
- ⚙️ **Easy Configuration**: Simple setup through the status bar or command palette
- 🔍 **Debug Tools**: Built-in debugging commands to troubleshoot configuration issues

## Requirements

- VS Code 1.90.0 or higher
- Claude.ai account with organization access
- Valid sessionKey or Cookie header from an active Claude.ai session

## Quick Start

1. **Install the extension** from the VS Code marketplace
2. **Click the status bar item** (shows "Claude --" initially)
3. **Enter your organization code** when prompted
4. **Paste your sessionKey** (or full Cookie header from Postman)
5. The extension will automatically start displaying your usage!

## Configuration

### Extension Settings

Configure the extension through VS Code settings or the command palette:

- `claudeUsage.organizationCode`: Your Claude organization code (required)
- `claudeUsage.mode`: Display mode - `"left"` (default) or `"used"`
- `claudeUsage.autoRefresh`: Enable/disable auto-refresh (default: `true`)
- `claudeUsage.refreshSeconds`: Refresh interval in seconds (minimum: 30, default: 60)

### Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **Claude Usage: Configure** - Open configuration menu
- **Claude Usage: Refresh Now** - Manually refresh usage data
- **Claude Usage: Toggle Used/Left** - Switch display mode
- **Claude Usage: Edit organization_code** - Update organization code
- **Claude Usage: Edit sessionKey** - Update session key
- **Claude Usage: Clear sessionKey** - Remove stored session key
- **Claude Usage: Debug Info** - Show current configuration details
- **Claude Usage: Open Settings** - Open VS Code settings

## Getting Your Credentials

### Organization Code

Your organization code can be found in the Claude.ai URL when viewing your organization:
```
https://claude.ai/api/organizations/{YOUR_ORG_CODE}/usage
```

### Session Key

You have two options:

1. **Full Cookie Header (Recommended)**: 
   - Open Claude.ai in your browser
   - Open Developer Tools (F12)
   - Go to Network tab
   - Make a request to Claude.ai
   - Copy the entire `Cookie` header value
   - Paste it into the extension

2. **Session Key Only**:
   - Open Developer Tools (F12)
   - Go to Application → Cookies → claude.ai
   - Copy the `sessionKey` cookie value
   - Paste it into the extension

## Privacy & Security

- 🔒 Session keys are stored securely using VS Code's secret storage
- 🔒 All data stays on your local machine
- 🔒 No data is sent to third-party servers
- 🔒 The extension only communicates with Claude.ai's API

## Troubleshooting

### HTTP 403 Errors

If you encounter a 403 error:

1. **Verify sessionKey**: Get a fresh one from an active browser session
2. **Check organization_code**: Should match your Claude organization
3. **Try full cookie string**: Copy entire Cookie header from Network tab
4. **Ensure you're logged in**: Make sure you're logged into Claude.ai in your browser
5. **Use Debug Info**: Run "Claude Usage: Debug Info" to check your configuration

### Extension Not Working

- Check that both organization code and sessionKey are configured
- Verify your sessionKey hasn't expired
- Try refreshing manually using "Claude Usage: Refresh Now"
- Check the VS Code Developer Console for error messages

## How It Works

1. The extension fetches the `__cf_bm` cookie from Cloudflare (required for API access)
2. Combines it with your sessionKey
3. Makes authenticated requests to Claude.ai's usage API
4. Displays the usage percentage in the status bar
5. Auto-refreshes at your configured interval

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Support

- 🐛 **Report Issues**: [GitHub Issues](https://github.com/E-FL/claude-usage/issues)
- 💡 **Feature Requests**: [GitHub Issues](https://github.com/E-FL/claude-usage/issues)
- 📖 **Documentation**: [GitHub Repository](https://github.com/E-FL/claude-usage)

## Acknowledgments

- Built for the Claude.ai community
- Uses VS Code's extension API for seamless integration

---

**Made with ❤️ for the Claude.ai community**

