# Connect the Blue-11 MCP server to Claude

[Blue-11](https://bluedragon-ctrl.github.io/Blue11/) is a small PDP-11-style computer for
teaching, programmed in octal assembly. Its MCP server lets Claude write Blue-11 programs, run
them on the same machine as the browser simulator, see the console, the registers and the
screen, debug them step by step, and give you a link that opens the program in the simulator.

It runs on your computer, so it works in **the Claude desktop app** (macOS, Windows) and in
**Claude Code**. The Claude website and phone apps can't start servers on your computer.

## 1. What you need

**Node.js 18 or later**: check with `node --version` in a terminal. If it is missing, install
the LTS version from [nodejs.org](https://nodejs.org).

## 2. Get the server

Pick one.

**A. From the repository** (updates with `git pull`). You need [git](https://git-scm.com):

```sh
git clone https://github.com/bluedragon-ctrl/Blue11.git
cd Blue11
npm install
npm run build -w apps/mcp
```

The server is now `Blue11/apps/mcp/dist/server.js`.

**B. One file.** If someone sent you `server.js`, put it in a folder that will stay where it
is (for example `~/blue11/server.js`, or `C:\blue11\server.js` on Windows). It contains
everything; it needs only Node.

Either way, note the **full path** to `server.js`. On macOS, drag the file into a terminal
window to see it.

## 3. Add it to the Claude desktop app

1. Open **Settings → Developer → Edit Config**. That opens `claude_desktop_config.json`
   (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`).
2. Put this in it, with your path. If the file already has an `"mcpServers"` section, add
   only the `"blue11"` entry to it.

   macOS / Linux:

   ```json
   {
     "mcpServers": {
       "blue11": {
         "command": "node",
         "args": ["/Users/you/Blue11/apps/mcp/dist/server.js"]
       }
     }
   }
   ```

   Windows (each `\` is written twice):

   ```json
   {
     "mcpServers": {
       "blue11": {
         "command": "node",
         "args": ["C:\\Users\\you\\Blue11\\apps\\mcp\\dist\\server.js"]
       }
     }
   }
   ```

3. Save, then **quit the Claude app completely and start it again** (on macOS: Claude → Quit,
   not just closing the window; on Windows: also from the tray icon).
4. In a new chat, open the **+** / tools menu: **blue11** should be listed with its tools
   (assemble, run, step, help, spec...).

## 4. Or add it to Claude Code

```sh
claude mcp add blue11 -- node /full/path/to/server.js
```

Inside a clone of the repository, nothing is needed: Claude Code offers the server from the
repository's `.mcp.json` (approve it once).

## 5. Try it

Ask Claude, for example:

- *"Using blue11, write a program that prints HELLO on the console and run it."*
- *"Draw a red square in the middle of the screen with blue11 and show me the screen."*
- *"Make a small game where an arrow key moves a dot, and give me the simulator link."*

Claude can read the students' help, the example programs and the full specification through
the server, so you don't have to explain the machine. When the program works, it gives you a
link that opens it in the simulator in your browser.

## If it doesn't show up

- **"spawn node ENOENT"** or the server fails to start: the app doesn't find Node. Use its full
  path as `"command"`: run `which node` (macOS) or `where node` (Windows) in a terminal and
  put the result there, e.g. `"/opt/homebrew/bin/node"` or `"C:\\Program Files\\nodejs\\node.exe"`.
  This is common when Node was installed with nvm.
- **Nothing listed:** check the JSON (a missing comma or bracket breaks the whole file; paste
  it into a JSON checker) and that the path to `server.js` is right, then restart the app.
- **Logs:** Settings → Developer shows the server's state; the logs are in
  `~/Library/Logs/Claude/mcp-server-blue11.log` (macOS) or `%APPDATA%\Claude\logs\` (Windows).
- To test the server by hand: `node /full/path/to/server.js` should start and wait silently
  (it talks on stdin). Stop it with Ctrl+C.

## Updating

- **A:** `git pull && npm install && npm run build -w apps/mcp` in `Blue11`, then restart the
  app.
- **B:** replace `server.js` with the new one, then restart the app.
