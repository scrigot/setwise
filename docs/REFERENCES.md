# Reference review

Reviewed on 2026-10-18:

- FullFran/training-mcp: https://github.com/FullFran/training-mcp
- Its MIT license: https://github.com/FullFran/training-mcp/blob/main/LICENSE
- Its shared-domain architecture: https://github.com/FullFran/training-mcp/blob/main/docs/architecture.md
- Its Go domain model: https://github.com/FullFran/training-mcp/blob/main/internal/training/model.go
- wger's MCP server: https://github.com/wger-project/mcp-server (AGPL-3.0; feature-reference only)
- MCP official server guide: https://modelcontextprotocol.io/docs/develop/build-server

The new Python implementation copies no source code from these repositories. The idea of using one shared domain layer for web and MCP informed the design. FullFran's license was verified but no third-party repository was installed or executed. The Python MCP SDK's installed/tested 1.29.0 API was used; the latest online guide may describe a different major SDK version.
