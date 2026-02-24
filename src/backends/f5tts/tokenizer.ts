export class F5Tokenizer {
  private readonly charToIndex: Map<string, number>;

  public constructor(vocabText: string) {
    this.charToIndex = new Map();
    const lines = vocabText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const char = (lines[i] as string).trim();
      if (char) {
        this.charToIndex.set(char, i);
      }
    }
  }

  public tokenize(text: string): Int32Array {
    const tokens: number[] = [];
    for (const char of text.split('')) {
      tokens.push(this.charToIndex.get(char) ?? 0);
    }
    return Int32Array.from(tokens);
  }
}
