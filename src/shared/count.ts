export function countText(text: string) {
  // 按非空白 Unicode 码点计字；汉字连续串与字母数字串各算一词，表情只计字。
  return {chars:Array.from(text.replace(/\s/gu,'')).length,words:(text.match(/[\p{L}\p{N}]+/gu)||[]).length};
}
