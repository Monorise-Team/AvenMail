import { monorise } from "@monorise-team/config/eslint";

export default monorise({ react: true, ignores: ["src-tauri/**"], tsconfigRootDir: import.meta.dirname });
