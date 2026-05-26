# CLI Prompt — Capsule CLI Development

You are working on the **Capsule CLI** (`capsule`), a Go command-line tool for managing cloud infrastructure.

---

## Stack

- **Go 1.22+**
- **Cobra** for command structure
- **Viper** for configuration management
- **lipgloss** for styled terminal output
- **tablewriter** for tabular output
- **OAuth2 Device Flow** for authentication

---

## Directory Structure

```
cli/
├── cmd/
│   ├── capsule/
│   │   └── main.go           # Entry point
│   ├── root.go               # Root command, global flags
│   ├── version.go            # `capsule version`
│   ├── auth.go               # `capsule auth login/logout/status`
│   ├── env.go                # `capsule env list/create/delete/status`
│   ├── deploy.go             # `capsule deploy`
│   ├── logs.go               # `capsule logs`
│   └── config.go             # `capsule config set/get/list`
├── internal/
│   ├── client/               # API client (HTTP)
│   ├── config/               # CLI config file management
│   ├── output/               # Table, JSON, YAML formatters
│   ├── auth/                 # Token storage, refresh logic
│   └── prompt/               # Interactive prompts
├── go.mod
└── go.sum
```

---

## Cobra Command Patterns

### Root Command

```go
// cmd/root.go
var rootCmd = &cobra.Command{
    Use:   "capsule",
    Short: "Your infrastructure, encapsulated",
    Long:  `Capsule CLI — manage cloud environments, deployments, and infrastructure from the terminal.`,
    PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
        return initConfig()
    },
}

func init() {
    rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default $HOME/.capsule/config.yaml)")
    rootCmd.PersistentFlags().StringP("output", "o", "table", "output format: table, json, yaml")
    rootCmd.PersistentFlags().BoolP("verbose", "v", false, "verbose output")

    viper.BindPFlag("output", rootCmd.PersistentFlags().Lookup("output"))
}
```

### Subcommand Pattern

```go
// cmd/env.go
var envCmd = &cobra.Command{
    Use:     "env",
    Aliases: []string{"environment", "environments"},
    Short:   "Manage environments",
}

var envListCmd = &cobra.Command{
    Use:   "list",
    Short: "List all environments",
    RunE: func(cmd *cobra.Command, args []string) error {
        client := mustGetClient(cmd)
        envs, err := client.ListEnvironments(cmd.Context())
        if err != nil {
            return fmt.Errorf("listing environments: %w", err)
        }
        return output.Print(cmd, envs)
    },
}

var envCreateCmd = &cobra.Command{
    Use:   "create <name>",
    Short: "Create a new environment",
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        name := args[0]
        desc, _ := cmd.Flags().GetString("description")

        client := mustGetClient(cmd)
        env, err := client.CreateEnvironment(cmd.Context(), name, desc)
        if err != nil {
            return fmt.Errorf("creating environment: %w", err)
        }

        fmt.Fprintf(cmd.OutOrStdout(), "✅ Environment %q created (ID: %s)\n", env.Name, env.ID)
        return nil
    },
}

func init() {
    envCmd.AddCommand(envListCmd, envCreateCmd)
    envCreateCmd.Flags().StringP("description", "d", "", "environment description")
    rootCmd.AddCommand(envCmd)
}
```

---

## Output Formatting

### Multi-format Output

```go
// internal/output/output.go
func Print(cmd *cobra.Command, data any) error {
    format := viper.GetString("output")

    switch format {
    case "json":
        return printJSON(cmd.OutOrStdout(), data)
    case "yaml":
        return printYAML(cmd.OutOrStdout(), data)
    case "table":
        return printTable(cmd.OutOrStdout(), data)
    default:
        return fmt.Errorf("unsupported output format: %s", format)
    }
}
```

### Table Output

```go
func printTable(w io.Writer, data any) error {
    switch v := data.(type) {
    case []domain.Environment:
        table := tablewriter.NewWriter(w)
        table.SetHeader([]string{"ID", "Name", "Status", "Created"})
        table.SetBorder(false)
        table.SetHeaderAlignment(tablewriter.ALIGN_LEFT)
        for _, env := range v {
            table.Append([]string{
                env.ID[:8],
                env.Name,
                colorStatus(env.Status),
                humanizeTime(env.CreatedAt),
            })
        }
        table.Render()
    }
    return nil
}
```

---

## Authentication Flow

### OAuth2 Device Flow

```
1. User runs `capsule auth login`
2. CLI requests device code from auth server
3. CLI displays: "Visit https://capsule.dev/device and enter code: ABCD-1234"
4. CLI polls for token completion
5. On success, stores tokens in $HOME/.capsule/credentials.json
6. Subsequent commands use stored access token
7. Auto-refresh on 401 responses
```

### Token Storage

```go
// internal/auth/store.go
type TokenStore struct {
    path string
}

type Credentials struct {
    AccessToken  string    `json:"access_token"`
    RefreshToken string    `json:"refresh_token"`
    ExpiresAt    time.Time `json:"expires_at"`
}

func (s *TokenStore) Save(creds *Credentials) error {
    data, _ := json.MarshalIndent(creds, "", "  ")
    return os.WriteFile(s.path, data, 0600) // restrictive permissions
}
```

---

## CLI UX Guidelines

1. **Confirm destructive actions** — `capsule env delete` prompts for confirmation unless `--yes` flag
2. **Progress indicators** — use spinners for long operations (deploy, provision)
3. **Color output** — use lipgloss for consistent colors; respect `NO_COLOR` env var
4. **Exit codes** — `0` success, `1` general error, `2` usage error
5. **Stderr for messages, stdout for data** — so output can be piped
6. **Helpful errors:**
   ```
   Error: environment "prod" not found

   Did you mean one of these?
     • prod-us-east
     • prod-eu-west

   Run 'capsule env list' to see all environments.
   ```

---

## Configuration

Config file location: `$HOME/.capsule/config.yaml`

```yaml
api_url: https://api.capsule.dev
default_org: kynto
output: table
verbose: false
```

Precedence: flags > env vars > config file > defaults

---

## Testing Checklist

- [ ] Test command output (capture stdout/stderr with `bytes.Buffer`)
- [ ] Test flag parsing and validation
- [ ] Test error messages for common failure modes
- [ ] Mock API client via interface
- [ ] Test interactive prompts with mock reader
- [ ] Test config file loading and precedence
