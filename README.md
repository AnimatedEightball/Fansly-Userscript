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

![](https://m.leak.fans/ss/2023-05-19_OXPiCK.png)<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<style>

:root {
  --border-radius-2: 0.5em;
  --scroll-bar: rgba(0, 0, 0, 0.15);
  --scroll-bar-track: rgba(0, 0, 0, 0.05);
  --dark-5: rgb(247, 249, 250);
  --border-color: rgba(0, 0, 0, 0.05);
  --dark-blue-1: rgba(86, 102, 120, 1);
  --blue-1-alpha-2: #2699f728;
}

html,
body {
  color: var(--font-1);
  font-family: "Roboto", sans-serif;
  font-size: 16px;
}

.flex-row {
  display: flex;
  flex-direction: row;
}

.flex-col {
  display: flex;
  flex-direction: column;
}

.flex-center {
  justify-content: center;
}

.flex-end {
  justify-content: flex-end;
}

.flex-start {
  justify-content: flex-start;
}

.flex-space-around {
  justify-content: space-around;
}

.flex-space-between {
  justify-content: space-between;
}

.flex-align-center {
  align-items: center;
}

.flex-align-end {
  align-items: flex-end;
}

.flex-align-start {
  align-items: flex-start;
}

.flex-align-self-center {
  align-self: center;
}

.flex-align-self-start {
  align-self: flex-start;
}

.flex-align-self-end {
  align-self: flex-end;
}

.flex-align-self-stretch {
  align-self: stretch;
}

.flex-0 {
  flex: 0 0 auto;
}

.flex-0-1 {
  flex: 0 1 auto;
}

.width-3 {
  width: 3em;
}

.width-100 {
  width: 100%;
}

.max-100 {
  max-width: 100%;
  box-sizing: border-box;
}

.max-50 {
  max-width: 50%;
  box-sizing: border-box;
}

.width-50 {
  width: 50%;
}


.message.my-message {
  align-self: flex-end;
}

.timestamp {
  margin: 0.1em 0 0 1em;
  font-size: 0.75em;
  color: var(--dark-blue-1);
}

.reply-target {
  background-color: var(--blue-1-alpha-2);
}

.timestamp.my-message {
  align-self: flex-end;
  margin: 0.1em 1em 0 0;
}

.message[_ngcontent] {
  border-radius: var(--border-radius-2);
  background-color: var(--dark-5);
  margin: 0.25em 0.5em;
  max-width: 60%;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 15em;
  display: flex;
}

.is-reply[_ngcontent]   .message[_ngcontent] {
  /* max-width: calc(60% - 2em); */
  min-width: 13em;
  width: calc(100% - 2em);
}

.message-wrapper[_ngcontent] {
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
}

.reply-spacer[_ngcontent] {
  width: 34px;
}

[_nghost]   .reply-footer-content[_ngcontent]   app-account-username[_ngcontent]     .display-name {
  font-weight: 400;
}

.my-message[_nghost]    > .message-reply-wrapper[_ngcontent]    > .message-text-wrapper[_ngcontent]   .message-wrapper[_ngcontent]   .message[_ngcontent] {
  background-color: var(--blue-1-alpha-2);
}

.my-message[_nghost]    > .message-reply-wrapper[_ngcontent]    > .message-wrapper[_ngcontent]   .message[_ngcontent] {
  background-color: var(--blue-1-alpha-2);
}

.my-message[_nghost]    > .message-reply-wrapper[_ngcontent]:not(.is-reply)    > .message-wrapper[_ngcontent]   .message[_ngcontent] {
  align-self: flex-end;
  justify-content: flex-end;
}

.my-message[_nghost]   .message-reply-wrapper[_ngcontent]:not(.is-reply)   .message-wrapper[_ngcontent] {
  justify-content: flex-end;
}

.my-message[_nghost]   .message-wrapper[_ngcontent]    > .message[_ngcontent] {
  order: 2;
}

.message.no-text[_ngcontent] {
  opacity: 0;
  pointer-events: none;
}

.message-text-wrapper[_ngcontent] {
  display: flex;
  flex-direction: column;
  position: relative;
}

.message-text-wrapper.no-text[_ngcontent] {
  margin-top: -28px;
  pointer-events: none;
}

.message-text-wrapper.no-text[_ngcontent]   .tap-backs[_ngcontent] {
  pointer-events: all;
}

.is-reply[_ngcontent]   .message-text-wrapper.no-text[_ngcontent] {
  margin-top: -18px;
}

.reply-header[_ngcontent] {
  display: flex;
  flex-direction: row;
  flex: 0 0 auto;
  margin-left: 10px;
  margin-top: 9px;
  justify-content: flex-start;
}

.reply-header.no-text[_ngcontent] {
  margin-top: 0;
}

.reply-header-content[_ngcontent] {
  border-radius: var(--border-radius-2);
  display: flex;
  flex-direction: row;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
}

.my-message[_nghost]    > .message-reply-wrapper[_ngcontent]:not(.is-reply)   .reply-header[_ngcontent] {
  justify-content: flex-end;
}

.reply-footer[_ngcontent] {
  display: flex;
  flex-direction: row;
  flex: 0 0 auto;
  margin-top: 2px;
  justify-content: flex-start;
}

.reply-footer-content[_ngcontent] {
  border-radius: var(--border-radius-2);
  margin: 0em 0.5em;
  margin-top: -0.5em;
  margin-bottom: 0.5em;
  max-width: 60%;
  display: flex;
  flex-direction: row;
  width: 100%;
  min-width: 15em;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
}

.my-message[_nghost]    > .message-reply-wrapper[_ngcontent]:not(.is-reply)   .reply-footer[_ngcontent] {
  justify-content: flex-end;
}

.my-message[_nghost]    > .message-reply-wrapper[_ngcontent]:not(.is-reply)   .reply-footer-content[_ngcontent] {
  justify-content: flex-end;
}

.reply-avatar[_ngcontent] {
  width: 1.4em;
  height: 1.4em;
}

.message-text[_ngcontent] {
  padding: 0.35em 0.75em;
  font-size: 0.9375em;
  color: var(--font-1);
  line-height: 1.6em;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: break-word;
  -webkit-hyphens: none;
  hyphens: none;
}

.emoji[_ngcontent] {
  width: 24px;
  height: 24px;
  transition: transform 150ms ease-in-out;
  margin: 0.4em;
  cursor: pointer;
}

.tap-backs[_ngcontent] {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
}

.my-message[_nghost]   .tap-backs[_ngcontent] {
  justify-content: flex-end;
}

.liked-type[_ngcontent] {
  display: flex;
  flex-direction: row;
  align-items: center;
  color: var(--dark-blue-1);
  font-size: 0.75em;
  padding: 0.25em 0.25em 0.25em 0.45em;
  border-radius: 0.5em;
  margin-right: 2px;
  cursor: pointer;
}

.liked-type.liked[_ngcontent] {
  border: 1px solid var(--border-color);
  cursor: pointer;
}

.liked-type.liked[_ngcontent]:hover {
  padding: 0.25em 0.25em 0.25em 0.25em;
}

.liked-type[_ngcontent]:hover   .emoji[_ngcontent] {
  transform: scale(1.25);
}

.liked-type[_ngcontent]   .emoji[_ngcontent] {
  cursor: inherit;
}

.liked-type.liked[_ngcontent]:hover   .unlike-icon[_ngcontent] {
  visibility: visible;
  display: inline;
}

.overlay-box[_ngcontent] {
  width: 10px;
  margin-left: -1em;
  margin-top: 0.7em;
  height: calc(100% - 5px);
  position: absolute;
  border: 3px solid transparent;
  border-top-left-radius: 20px;
  border-bottom-left-radius: 20px;
  border-left-color: var(--border-color);
  border-top-color: var(--border-color);
  border-bottom-color: var(--border-color);
}

</style>
</head>
<body>
	<app-messages-conversation-route>
		<app-group-message-container class="message-content" >
			<div class="message-content-list">
				<div class="message-collection-wrapper">
				</div>
			</div>
		</app-group-message-container>
	</app-messages-conversation-route>
</body>
<script src="messageData.js"></script>
<script type="text/javascript">

const createMessageHTML = ({
  content,
  createdAt,
  senderId,
  inReplyToMessage = null,
  attachments,
  likes = [{}],
  isReply = null
}) => {

	// recursion happens here, if a parent message was being replied to, grab it here
	// this code does add some unnecessary divs, that aren't applied in the source, they don't seem to cause a problem, but we can flag them later, so they only output if it's a regular message
	//we're not gonna bother with a timestamp on the message being replied to, at least for now, you can just search for it if you want the time
	if(inReplyToMessage) {
		inReplyToMessage.isReply = 'true';
		[inReplyToMessage].map(createMessageHTML);
	}

	const message = document.createElement('template');
	message.innerHTML =`<app-group-message-collection class="message-collection" >
		<div class="flex-row width-100">
			<div class="flex-col width-100">
				<div class="flex-col width-100">
					<app-group-message class="${isReply ? 'message-reply':'message'}${senderId==userID ? ' my-message':''}" _nghost="">
						<div _ngcontent="" class="message-reply-wrapper${isReply ? ' is-reply':''}">
						${inReplyToMessage? [inReplyToMessage].map(createMessageHTML)[0].innerHTML:''}
						${attachments!=''? "we've got attachments":''}
							<div _ngcontent="" class="message-text-wrapper">
								<div _ngcontent="" class="message-wrapper">
								${isReply ?
									`<div _ngcontent="" class="reply-header">
										<div _ngcontent="" class="reply-header-content">
											<div _ngcontent="" class="overlay-box"></div>
										</div>
									</div>`:''}
									<div _ngcontent="" class="message">
										<div _ngcontent="" class="message-text">${content}</div>
									</div>
								</div>
								<div _ngcontent="" class="tap-backs">
									${likes.map(like => `
									  <div _ngcontent="" class="liked-type">
										${(() => {
    switch (like.type) {
      case 1:
        return "❤️";
      case 2:
        return "😂";
      case 3:
        return "😯";
      case 4:
        return "😢";
      case 5:
        return "🔥";
      case 6:
        return "👍";
      default:
        return "👎";
    }
  })()}
									  </div>`
									).join('')}
								</div>
							</div>
						</div>
					</app-group-message>
				</div>
${!isReply ? `				<div class="timestamp ${senderId==userID ? 'my-message':''}">
					<span class="margin-right-text"> ${new Date(createdAt * 1000).toLocaleString('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true
})} </span>
				</div>`:''}

			</div>
		</div>
	</app-group-message-collection>`.trim();

	//return message.content.firstChild;
	const messageElement = message.content.firstElementChild;

	return messageElement;
};
const userID = messageData.userId;
// Create the HTML for each message.
const messageLog = messageData.messages.map(createMessageHTML);

//console.log (messageLog);

// And add it for each HTML template to the body.
messageLog.forEach(message => {
  document.body.querySelector('.message-collection-wrapper').append(message);
});


//Take old, existing, JSON object, merge with new, replace old
//sort out and remove duplicate objects/arrays
//Clean out unnecessary fields

//Grab only specific objects from main JSON object
//const { accountMedia, accountMediaBundles, messages } = json[0].response;

//sort an object by ID values, in descending order (newest first)
//messages.sort((a, b) => b.id.localeCompare(a.id));

//Select specific array from accountMedia based on it's ID
function findAccountMediaByID(id) {
	return accountMedia.find(item => item.id == id);
}
//findAccountMediaByID("862941176716603394");

//json[0].response.accountMediaBundles.find(item => item.id = "788576864472932352");

//Select specific array from accountMediaBundles based on it's ID
function findAccountMediaBundlesByID(id) {
	return accountMediaBundles.find(item => item.id == id);
}
//findAccountMediaBundlesByID("862941177060532224");
</script>
</html>

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

