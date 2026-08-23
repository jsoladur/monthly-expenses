import type en from "@/i18n/messages/en.json";

declare module "use-intl" {
  interface AppConfig {
    Messages: typeof en;
  }
}

export {};
