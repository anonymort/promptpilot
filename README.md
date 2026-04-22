# PromptPilot

PromptPilot is a browser extension for improving prompts before they go back into the page.

It is designed for people who already work inside tools like ChatGPT, Claude, and other prompt-driven products, but want a faster way to clean up rough instructions, sharpen intent, and rewrite messy drafts without leaving the tab they are on.

## What it does

PromptPilot helps you:

- read the prompt from the field you are currently editing
- rewrite it into a clearer, stronger version
- review the result before using it
- insert the improved version back into the page or copy it elsewhere

The flow is intentionally manual and visible. PromptPilot does not silently rewrite text, auto-submit forms, or run on every site in the background.

## How the extension works

The popup follows a simple three-step workflow:

1. Click `Read from page` to capture the active editable field.
2. Click `Enhance` to improve the prompt for the current site and mode.
3. Review the result, then click `Insert into page` or `Copy result`.

You can also skip step 1 and paste your own prompt directly into the popup.

## Why people use it

PromptPilot is useful when you want to:

- turn a vague request into something more specific
- tighten a long, rambling prompt
- rewrite rough instructions into a cleaner structure
- adapt a prompt for UI, landing page, dashboard, mobile, or form-related work
- keep your original workflow inside the site you are already using

## Enhancement modes

PromptPilot currently includes these modes:

- `General`
- `Landing page`
- `Dashboard`
- `Mobile UI`
- `Form flow`

These modes help shape the rewrite toward the kind of output you are trying to get.

## Accounts and usage

PromptPilot uses account-based usage limits.

Current limits:

- `Free`: 2 enhancements per day
- `Starter`: 120 enhancements per month
- `Pro`: 400 enhancements per month
- `Supporter`: unlimited

The popup shows your current plan and usage so you can see where you stand at a glance.

## Supporter unlock

PromptPilot also supports a simple supporter unlock through Buy Me a Coffee.

If you donate using the same email address as your PromptPilot account, unlimited usage can be unlocked automatically on that account.

Buy Me a Coffee:

- [buymeacoffee.com/mattkneale](https://buymeacoffee.com/mattkneale)

## What PromptPilot does not do

PromptPilot is deliberately conservative about browser access.

It does not:

- auto-send prompts for you
- rewrite text invisibly
- scrape every page in the background
- submit forms without your action

You stay in control of what gets read, enhanced, copied, and inserted.

## Who it is for

PromptPilot is a good fit for:

- people who prompt AI tools every day
- designers and product builders refining UI requests
- marketers shaping landing page instructions
- founders and indie hackers iterating quickly
- anyone who wants better prompts without breaking flow

## Current status

PromptPilot is an early-stage browser extension and backend project under active development.

The experience is already usable, but parts of the product are still evolving, including onboarding, billing, polish, and browser distribution.

## Project structure

If you are browsing the repository, the main parts are:

- `extension/` — the browser extension popup and client logic
- `backend/` — the API that handles accounts, plans, usage, and prompt enhancement
- `docs/` — supporting notes and internal documentation

## For developers

This README is intentionally product-facing. If you are looking for implementation details, deployment notes, or architecture docs, start in:

- [docs](/Users/matt/Coding/promptpilot/docs)
- [backend](/Users/matt/Coding/promptpilot/backend)
- [extension](/Users/matt/Coding/promptpilot/extension)
