import dotenv from "dotenv";
import { buildConfig } from "./configBuilder.js";

dotenv.config();

function loadConfig() {
  try {
    return buildConfig(process.env);
  } catch (error) {
    console.error(error.message);

    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }

    throw error;
  }
}

export const config = loadConfig();
