# Fansly-Userscript
A Fansly download userscript that supports mobile downloading and text message archiving, based on the Userscript by M-arcus (https://gist.github.com/M-rcus/a29673a5fcf22afd0e67d549b36496a7)

Gonna update/revise this later, but for now I'm using putting the original readme at the bottom and some really bad instructions up here.

If you want to use this on Android, install the Edge Browser (I initially tried Firefox, but didn't get it to work), install the Tampermonkey Extension, and then install the userscript.

Post downloads work the same as on PC, you have to open a specific post, this won't work off the wall or home page, click on the post, click on the three dot menu. At the bottom of the menu you'll see "Download media", click it and get your downloads.

In DMs, on mobile you can't see the desktop button, so click the three dot menu in the upper right. At the top of the dropdown you'll see a "Download messages" button. Click it and you'll get a pop up. It grabs messages in batches of 50, if there's media, it'll show up in the dropdown. Click "Load More" to grab the next 50 messages back, etc. You can check "Load complete message history" and it'll just grab everything for you. Select the DM you wanna download and click "Download!". Pretty easy.

If you wanna download the conversation, it uses the same messages that've loaded for media, but click "Download messages!". This gives you a messageData.js file. If you also download ChatLog.html and put it in the same folder as a messageData.js it'll load your conversation. No media is displayed in the log.

No idea if I'll ever update this or have time to respond to questions or anything, but feel free to leave feedback.


# Fansly Download

A work-in-progress userscript for downloading media from Fansly.

> [!CAUTION]
> From late 2024 up until March 25th, 2026, the `violentmonkey-dom` library was being retrieved from a personal server of mine at `https://m.leak.fans/ujs/violentmonkey-dom-v1.0.9.js`. The backend server that was hosting this script was hosted by a former friend of mine and either them or someone else injected a **malicious version** of this script that sent credentials off to a third-party server.  
> I have since migrated the `m.leak.fans` files to a server I am in control of myself (as well as removed any DNS records for the server credentials were sent to), and replaced the `violentmonkey-dom` library with the official v1.0.9 version. In addition to this, if you have installed the script during that time period, please make sure to update to the latest version (v0.9.3) of this userscript to ensure you have the clean version of the `violentmonkey-dom` library.  
> Note that the previously mentioned URL that leads to m.leak.fans may still be cached. I have cleared the cache on Cloudflare's side, but it's possible your browser has still cached the malicious version.
> For those of you affected by this, please visit [Fansly session settings](https://fansly.com/settings/sessions) and "Delete all sessions", then log back into Fansly.  
> You may also want to change your password on Fansly, and any other website where you used the same password, just to be safe.  
> I apologize for any inconvenience caused by this, and I will be more careful with third-party dependencies in the future. This is 100% on me and I take full responsibility for this incident. If you have any questions or concerns, please feel free to reach out to me.

## Installation and usage

1. Install a userscript extension (such as [Violentmonkey](https://violentmonkey.github.io/get-it/)).
2. Click on [this link](https://gist.github.com/M-rcus/a29673a5fcf22afd0e67d549b36496a7/raw/fansly-download.user.js) and your userscript extension should prompt you to install.
3. Go on a Fansly post, make sure to click on the post so the URL looks something like: `https://fansly.com/post/123456789...`
4. Click on the three dots top-right of the post. You should see a "Download media" option:

![](https://m.leak.fans/ss/2023-05-19_OXPiCK.png)
### Messages

For messages, go to your Fansly messages and select a "message thread" on the sidebar from the creator you wish to download from. Depending on how many messages have been received/sent, it may take a short while to get all the messages. Eventually you should see this button and icon:

![](https://m.leak.fans/ss/2026-02-26_iQbDU4.png)

Once you click that, you should get this popup with a dropdown of available media in that message thread:

![](https://m.leak.fans/ss/2026-02-26_vU8MKA.png)

> This image is a screenshot from v0.8.3, so any newer versions may look slightly different.

Please note that the message download feature still isn't perfect. Sometimes it lists media you don't actually have access to.  
If you notice media that's _missing_, but that you definitely have access to, feel free to let me know.

## Bug reports and issues

If you encounter any bugs or issues, feel free to comment here about them or send me an email: [`m@rcus.dev`](mailto:m@rcus.dev)

## [Experimental] Downloading the highest-quality videos via in-browser M3U8 fetching and transmuxing

As of v0.8.0 there's an experimental feature that uses the M3U8 playlist for downloading videos (available for video uploads in the past few years, only the earliest videos don't have this).  
These "playlists" have effectively split one video file into multiple small chunks. Effective to save bandwidth costs on Fansly's side, a pain to work with for userscripts. With the help of _Claude_, I've implemented in-browser fetching of the M3U8 playlist and transmuxing of the chunks into a single MP4 file via mux.js. This should allow for higher-quality video downloads without needing to use the old "script download" method.

This feature needs to be explicitly enabled via the userscript manager's context menu (at least on Violentmonkey). The reason for this is that for large videos (long livestreams), the playlist method can be quite resource-intensive and may even crash the browser (though unconfirmed). The old method of fetching the direct video URL (which is usually a lower-quality MP4) is much more lightweight, so you can toggle between the two methods based on your needs.

Click your userscript manager's icon, and you should see an option like these:

![](https://m.leak.fans/ss/2026-02-25_sqb7QY2.png)

If it says "M3U8 in-browser download: OFF", click it to turn it on. You should see a console log confirming the change: `M3U8 in-browser download set to true`  
Click it again to toggle it off if you want to switch back to the old method.

During a download there won't be anything on the Fansly website visually telling you progress, but you can open the browser console to see logs for when the M3U8 playlist is being fetched, when each chunk is being downloaded, and when the final MP4 is being generated.

## Changelog

### v0.9.4 - 2026-03-25
- Modifications to work on Android (dunno about iPhone) and back up chat logs (media is already handled)

### v0.9.3 - 2026-03-25
- `violentmonkey-dom` now gets retrieved from [jsDelivr](https://www.jsdelivr.com/package/npm/@violentmonkey/dom). See notice at the top of this README for more details.

### v0.9.2 - 2026-03-02

- Improved the handling of "Download media" button in the dropdown of posts. From my testing this works better than before, but if you notice any issues with it please let me know.

### v0.9.1 - 2026-03-02

- The message media download modal now shows how many messages have been retrieved from Fansly, as well as how many media items have been found in those messages.
  - This should be better feedback to you when you click the "Load more messages" button, so you can see how many messages have been loaded and how many media items have been found in those messages. Especially if you have a lot of messages where there's no media (chatting back and forth with the creator but no media is being sent).

### v0.9.0 - 2026-02-27

- Bugfix: Message conversations (DMs) are no longer fetched every time you switch conversations. This should avoid hitting too many rate limits with Fansly's API.
- When you open the modal for downloading message media, it only retrieves the 100 most recent messages.
  - To compensate there's now a "Load more messages" button that fetches the next 100 messages, then another 100 messages, and so on until there are no more messages to fetch.
  - You also have the option to toggle "Load all messages" and then press the button, which will fetch all messages in the conversation. For creators where you've been yapping back and forth a lot over time, this can take some time to finish. Use it at your own discretion. :)
- Message media listed in the download modal no longer show media _you_ have sent. Only media sent from the creator.
  - Currently this cannot be changed, but if someone wants to be able to download media they have sent themselves, then I can add a toggle.

### v0.8.3

- Fixes a very minor issue with the download icon for the "Download media" on regular posts (not messages).

### v0.8.2

- Fixes the video duration / length reported by Windows Explorer.
- Implements rate limit handling for API calls, so that it doesn't break when fetching a lot of messages etc.

### v0.8.1

- Fixes some MP4 metadata generated by the M3U8 transmuxing process, such as the creation date.
- No longer downloads preview media when you have access to the original media.

### v0.8.0

- Introduces in-browser M3U8 fetching and transmuxing to MP4 via mux.js, which should allow for higher-quality video downloads without needing to use the script download method.
- Toggleable via the userscript manager's context menu (at least on Violentmonkey).

### v0.7.0

- Works around a "fix" implemented by Fansly, since they now limit to 50 entries per API request. The script now makes multiple requests if needed to get all media.

### v0.6.0

- Fixes image downloading.
- Note: video downloading is still kind of low resolution for newer posts, as Fansly uses M3U8 playlists (which can't really be merged into MP4s easily via a simple userscript).
- Advanced users are recommended to set the `SCRIPT_DOWNLOAD` value to true, which will give you a Bash script that utilizes `curl` and `yt-dlp` to download images/videos.

### v0.2.0

- Introduces experimental messages support.
- Go to your Fansly messages and select a "message thread" on the sidebar.
- Above the message thread list, there should be a download icon that pops up: https://i.im.ge/2022/08/17/OqDqtc.2022-08-17-nkWxV3.png

