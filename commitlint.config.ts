import type { UserConfig } from "@commitlint/types";
import { RuleConfigSeverity } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      RuleConfigSeverity.Error,
      "always",
      ["feat", "fix", "refactor", "docs", "test", "chore", "ci", "build", "perf", "revert"],
    ],
    "type-case": [RuleConfigSeverity.Error, "always", "lower-case"],

    "scope-empty": [RuleConfigSeverity.Error, "never"],
    "scope-case": [RuleConfigSeverity.Error, "always", "kebab-case"],
    "scope-enum": [
      RuleConfigSeverity.Error,
      "always",
      [
        "base",
        "schema",
        "compiler",
        "hot-codec",
        "hot-consumer",
        "hot-publisher",
        "hot-binding",
        "hot-publication",
        "conformance",
        "fixtures",
        "docs",
        "tooling",
        "repo",
        "release",
      ],
    ],

    "subject-empty": [RuleConfigSeverity.Error, "never"],
    "subject-case": [RuleConfigSeverity.Disabled],

    "header-max-length": [RuleConfigSeverity.Error, "always", 100],
  },
};

export default config;
