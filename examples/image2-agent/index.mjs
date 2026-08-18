export async function createAgent() {
  return {
    async handle(input) {
      const prompt = input.text.trim();
      if (!prompt) return { text: "请描述你想生成的图片。" };
      return {
        text: "已收到生图请求，正在交给 Image 2 生成。",
        image: { prompt, size: "1024x1024", quality: "medium" }
      };
    }
  };
}
