# Supabase CLI Access

No MCP server is configured. Use the `SUPABASE_ACCESS_TOKEN` from `app/.env.local` with the `--linked` flag and `--workdir` pointing to the repo root.

```bash
SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN \
  supabase db query --linked --workdir /Users/garrett/Code/PindejosBowling \
  "SELECT ..."
```

Project ref: `lyihsvxraurjghjqxaau`  
Supabase URL: `https://lyihsvxraurjghjqxaau.supabase.co`
