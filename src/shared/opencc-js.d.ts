declare module "opencc-js" {
  export type LocaleCode = "cn" | "tw" | "twp" | "hk" | "jp" | "t";

  export function Converter(options: {
    from: LocaleCode;
    to: LocaleCode;
  }): (text: string) => string;
}
