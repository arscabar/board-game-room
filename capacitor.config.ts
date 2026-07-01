import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.boardgamewebapp.room",
  appName: "Board Game Room",
  webDir: "dist",
  server: {
    androidScheme: "https"
  }
};

export default config;
