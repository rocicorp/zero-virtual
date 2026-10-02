# Zero chat demo

A small React chat UI with Zero queries, optimistic sends, and a window-scrolled
message history. The existing React and Solid list apps run separately.

## Run

Install with `pnpm install` from the repository root. Start the shared database
and Zero cache as described in the root README, then run `pnpm dev:chat`.
Open http://localhost:5175 and click **Seed 2,000 messages**.

## Start reading here

- [Chat.tsx](./Chat.tsx) assembles the UI: messages between two spacers, a toolbar,
  and a composer. This is the starting point for your own layout.
- [use-chat.ts](./use-chat.ts) connects Zero to `useZeroWindowVirtualizer`, enables
  `useStickToBottom`, restores scroll state, and exposes `send` and `jumpToLatest`.
- [../shared/chat.ts](../shared/chat.ts) defines the page, single-message, and
  latest-message queries and the `send` mutator. The shared query/mutator registries
  register these definitions for both the client and the API server.
- [main.tsx](./main.tsx) supplies `ZeroProvider` with the schema, mutators, and URLs.

The `Message` and `Composer` components are ordinary React UI. `DemoControls`
contains only seeding and fake incoming messages; you can omit it from your app.
`use-window-follow` provides toolbar status and unread counts. The stylesheet
uses measured toolbar and composer heights for document scroll padding.
The chat's color palette is defined as CSS variables near the top of
`Chat.module.css`; components inherit them for easy customization.

## Adapt it

1. Replace the shared demo `item` table with your message table. This demo maps
   `title` to author and `description` to body; the chat queries select `chat-`
   IDs. The list demos show all items, including chat messages. In your app,
   filter queries by conversation ID.
2. Keep the page query ordered by timestamp **and ID** so equal timestamps have
   a stable order. The pagination cursor needs those two fields.
3. Wire the page and single-message queries into the virtualizer. Keep
   `listContextParams` stable between renders; change it when changing conversations.
4. Render `items` in normal document flow between `spaceBefore` and `spaceAfter`.
   Every row, including loading placeholders, needs `rowAttributes(index, key)`.
5. Send through your registered mutator. Await only `.client` for the local
   optimistic write; Zero reconciles with the server in the background. The
   composer clears immediately and restores the draft if the local write fails.
   Zero 1.9 logs server failures and resolves `.server` with an error result;
   use `.server.then(...)` if your app needs to display those errors too.

`useStickToBottom` follows new content only while you're at the bottom. The
window variant receives the element containing the rows, not `window` itself.

## Dynamic toolbar and composer heights

The sticky toolbar and fixed composer size themselves from their content.
[use-window-insets.ts](./use-window-insets.ts) measures both on mount and uses
`ResizeObserver` to update `--chat-header-height` and `--chat-footer-height` on
`html` when controls wrap, fonts change, or error text appears.

[Chat.module.css](./Chat.module.css) uses those values in `scroll-padding-block`
on the document scroll container. The virtualizer reads that padding when
aligning a message, keeping it clear of the toolbar and composer. Use row
`scroll-margin` if you also want extra space around individual messages.

Scroll padding changes alignment; it does not add layout space. The
`composerSpace` element reserves the measured footer height after the messages,
so the final message can scroll fully above the fixed composer. Keep it inside
the messages wrapper observed by `useStickToBottom`, so composer height changes
also re-pin the window while following latest. The sticky toolbar already
occupies space in normal document flow.

Keep the measurements out of the bars' own height rules so their heights remain
dynamic. The hook disconnects its observer and removes the variables on unmount.
If your layout has no overlapping bars, omit this hook, the scroll padding, and
the `composerSpace` element.

## Try it

- Enter sends; Shift + Enter inserts a line break.
- The incoming-message checkbox inserts a message every five seconds.
- Scroll into history to pause following and see unread counts. Jump to latest
  to resume. The demo's unread query watches the latest 100 messages.
- Expand `notes.txt` to change a message's height.
- Message links and scroll positions survive reloads and back/forward navigation.
- Seeding is repeatable and preserves messages sent from the composer.

This uses the demo's anonymous shared backend. Add your own identity,
authorization, and conversation membership when adapting it to a real app.
