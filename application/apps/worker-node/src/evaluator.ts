export class Evaluator {
  /**
   * Compares the actual output against the expected output.
   * Strips all trailing whitespace and normalizes line endings to prevent 
   * formatting differences (like \r\n vs \n) from failing a correct answer.
   */
  public static compare(actual: string, expected: string): boolean {
    const normalize = (str: string) => 
      str.split('\n')
         .map(line => line.trimEnd()) // Remove trailing spaces on each line
         .join('\n')
         .trim();                     // Remove leading/trailing newlines entirely

    return normalize(actual) === normalize(expected);
  }
}