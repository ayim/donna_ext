# Browser Data Collection Extension

A browser extension for collecting and organizing browsing data, social media interactions, and notes.

## Project Overview

This extension helps users collect and organize their digital footprint across different platforms, including:
- Browser history
- Reddit interactions



## Features & Tasks

### Data Collection & Storage

#### Browser History
- [*] Initial History Collection
  - Get all existing browser history (URL, title)
  - Export to JSON format
  - Store in structured format

#### Social Media Integration

- [ ] Reddit Integration
  - [*] Save new Reddit posts and upvotes
  - [*] Store post URL
  - [ ] Store post content

- [ ] Twitter Integration
  - Track saved posts
  - Store post author
  - Store post content
  - Store event timestamp
  - Export to JSON format

#### Apple Notes Integration
- [ ] Notes Collection
  - Access Apple Notes data
  - Extract note contents
  - Export to JSON format

It's currently a single user application, we need to implement

- [ ] Categorization of sensitive data (i.e. NSFW posts, Banking, etc.)
- [ ] Multi-user support
- [ ] Access controls for other apps that may want to use this data

Front End

- [ ] Clean state: Show list of all available evidence
- [ ] Clean state: Automatically group tasks based on evidence
- [ ] Dirty state: Show evidence associated and unassociated with tasks
- [ ] Dirty state: Add evidence to a task
- [ ] Dirty state: Chat with the task and its evidence
- [ ] Dirty state: Create a todo list or suggest next action based on evidence
- [ ] Expansion: Create a new task and look for evidence.

Agent Capabilities

- [ ] Payment integration (store securely)
- [ ] Add an agent and ask to permissions to provide evidnence.