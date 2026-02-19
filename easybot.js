export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    try {
      // ===== Get update from Telegram =====
      const update = await request.json();
      console.log("📩 Update received:", JSON.stringify(update));

      const post = update.channel_post;
      if (!post) return new Response("OK");

      const postText = post.text || post.caption || "";
      const postPhotos = post.photo || [];
      const postVideo = post.video;

      const roleId = env.ROLE_ID || null;

      // ===== Parse configs from Settings (Text -> JSON.parse) =====
      let webhookConfig = [];
      let embedConfig = {};
      try {
        webhookConfig = JSON.parse(env.WEBHOOK_CONFIG || "[]");
      } catch {
        console.log("❌ Invalid WEBHOOK_CONFIG JSON");
        webhookConfig = [];
      }
      try {
        embedConfig = JSON.parse(env.EMBED_CONFIG || "{}");
      } catch {
        embedConfig = {};
      }

      // ===== NoPost check =====
      const noPostTags = webhookConfig.find(w => w.name === "NoPost")?.tags || [];
      if (noPostTags.some(tag => postText.includes(tag))) {
        console.log("⛔ NoPost tag found, skipping post");
        return new Response("OK");
      }

      // ===== Select webhook =====
      let selectedWebhook = webhookConfig.find(w => {
        if (w.name === "NoPost" || w.name === "Default") return false;
        const tags = w.tags || [];
        const matchTags = tags.some(tag => postText.includes(tag));
        const matchContains = w.contains && postText.includes(w.contains);
        return matchTags || matchContains;
      });

      // Use Default if no match
      if (!selectedWebhook) {
        selectedWebhook = webhookConfig.find(w => w.name === "Default");
        if (!selectedWebhook || !selectedWebhook.webhook) {
          console.log("⛔ No webhook found including Default, skipping post");
          return new Response("OK");
        }
        console.log(`⚡ Using Default webhook: ${selectedWebhook.webhook}`);
      } else {
        console.log(`🔗 Webhook selected: ${selectedWebhook.webhook}`);
      }

      const tgMessageUrl = `https://t.me/${post.chat.username}/${post.message_id}`;

      // ===== Build embed =====
      let embedTitle = embedConfig.telegramTitle || "Click to read in Telegram";
      let embedColor = embedConfig.telegramColor ? parseInt(embedConfig.telegramColor.replace("#", ""), 16) : 0x007BFF;

      if (postVideo) {
        embedTitle = embedConfig.videoTitle || "Click to watch video";
        embedColor = embedConfig.videoColor ? parseInt(embedConfig.videoColor.replace("#", ""), 16) : 0xFF9900;
      }

      const embed = { title: embedTitle, url: tgMessageUrl, color: embedColor };

      // ===== Build mention =====
      let mention = "";
      const useEveryone = ["true", "1"].includes((env.USE_EVERYONE || "").toLowerCase());

      if (roleId) {
        mention = `<@&${roleId}>`;
      } else if (useEveryone) {
        mention = "@everyone";
      }

      // ===== Build message content =====
      let content = `${mention}\n${postText}`;
      if (postPhotos.length > 0) content += `\n`;

      // ===== Send photo if exists =====
      if (postPhotos.length > 0) {
        const photo = postPhotos[postPhotos.length - 1]; // largest photo
        const fileId = photo.file_id;

        const fileInfoResp = await fetch(
          `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getFile?file_id=${fileId}`
        );
        const fileInfo = await fileInfoResp.json();

        if (!fileInfo.ok || !fileInfo.result.file_path) {
          content += "\n❌ Failed to get image from Telegram";
        } else {
          const filePath = fileInfo.result.file_path;
          const fileResp = await fetch(
            `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`
          );
          const arrayBuffer = await fileResp.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: "image/jpeg" });

          const form = new FormData();
          form.append("payload_json", JSON.stringify({ content, embeds: [embed] }));
          form.append("file", blob, "image.jpg");

          await fetch(selectedWebhook.webhook, { method: "POST", body: form });
          console.log("✅ Photo sent to Discord");
          return new Response("OK");
        }
      }

      // ===== Send embed only if no photo =====
      await fetch(selectedWebhook.webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, embeds: [embed] })
      });
      console.log("✅ Embed sent to Discord");

      return new Response("OK");

    } catch (err) {
      console.error("❌ Worker error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }
};
