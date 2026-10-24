// A narrow ingestion guard, not a complete personal-data classifier.
export function containsSensitivePattern(value: string): boolean {
  const financialSuffix="(?![\\d.]|\\s*(?:万亿元|亿元|万元|元|%|％))";
  const phone=new RegExp(`(?<![\\d.])1[3-9]\\d{9}${financialSuffix}`);
  const identity=new RegExp(`(?<![\\d.])\\d{17}[\\dXx]${financialSuffix}`);
  return phone.test(value)||identity.test(value)||/sk-[A-Za-z0-9_-]{12,}/.test(value);
}
