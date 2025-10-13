import React, { useMemo, useState } from 'react'
import { Button } from './ui/button'
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export interface ChatSummary {
  id: string
  title: string
  lastMessage?: string
  updatedAt?: string // ISO
}

interface ChatSidebarProps {
  chats: ChatSummary[]
  onSelect: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  activeId?: string | null
  collapsed?: boolean
  onToggle?: () => void
}

export function ChatSidebar({ chats, onSelect, onNewChat, onRename, onDelete, activeId, collapsed = false, onToggle }: ChatSidebarProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const filteredChats = useMemo(() => {
    if (!searchTerm.trim()) return chats
    const term = searchTerm.trim().toLowerCase()
    return chats.filter((chat) => {
      const inTitle = chat.title?.toLowerCase().includes(term)
      const inMessage = chat.lastMessage?.toLowerCase().includes(term)
      return inTitle || inMessage
    })
  }, [chats, searchTerm])

  const startRename = (chat: ChatSummary) => {
    setEditingId(chat.id)
    setDraftTitle(chat.title)
  }

  const cancelRename = () => {
    setEditingId(null)
    setDraftTitle('')
  }

  const commitRename = () => {
    if (!editingId) return
    const trimmed = draftTitle.trim()
    if (trimmed && trimmed.length) {
      onRename(editingId, trimmed)
    }
    cancelRename()
  }

  if (collapsed) {
    // Compact vertical bar
    return (
  <aside className="w-16 h-full bg-neutral-950/95 border-r border-neutral-900 flex flex-col items-center py-3 space-y-4 backdrop-blur">
        <button onClick={onNewChat} title="New chat" className="p-2 rounded-md hover:bg-neutral-800/60 transition" aria-label="New chat">
          <Plus className="w-4 h-4 text-neutral-200" />
        </button>
        <nav className="flex-1 w-full space-y-2 flex flex-col items-center px-1 overflow-y-auto">
          {chats.map(c => {
            const isActive = activeId === c.id
            return (
              <button key={c.id} onClick={() => onSelect(c.id)} title={c.title} className={`w-10 h-10 rounded-md flex items-center justify-center ${isActive ? 'bg-primary/20 ring-1 ring-primary/30 translate-x-0' : 'bg-neutral-800/30 hover:bg-neutral-800/60'} transition-all`}>
                <span className="text-xs font-semibold text-primary">{c.title?.charAt(0)?.toUpperCase() || '?'}</span>
              </button>
            )
          })}
        </nav>
        <button
          onClick={onToggle}
          title="Expand"
          className="p-2 rounded-md hover:bg-neutral-800/60 transition"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="w-4 h-4 text-neutral-200" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-72 min-w-[18rem] bg-neutral-950/95 text-neutral-100 border-r border-neutral-900 h-full flex flex-col shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="px-4 pt-4 pb-3 border-b border-neutral-900">
        <Button
          onClick={onNewChat}
          variant="ghost"
          className="w-full justify-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-800/80 hover:border-neutral-700 transition-all duration-200 font-semibold font-serif text-sm"
        >
          <Plus className="w-4 h-4" />
          New research chat
        </Button>
        <div className="mt-4 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search chats"
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-neutral-800 bg-neutral-900/70 text-sm placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-2">
        {filteredChats.length === 0 ? (
          <div className="px-3 py-6 text-sm text-neutral-500 font-serif">
            No chats match your search.
          </div>
        ) : (
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {filteredChats.map((chat) => {
                const isActive = activeId === chat.id
                const isEditing = editingId === chat.id

                return (
                  <motion.li
                    key={chat.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <div
                      className={`group flex items-center gap-2 rounded-xl border px-3 py-2 transition-all duration-200 ${isActive ? 'border-primary/50 bg-primary/10 shadow-lg shadow-primary/10' : 'border-transparent hover:border-neutral-800 hover:bg-neutral-900/60'}`}
                    >
                      {isEditing ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault()
                            commitRename()
                          }}
                          className="flex-1"
                        >
                          <input
                            value={draftTitle}
                            onChange={(event) => setDraftTitle(event.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                cancelRename()
                              }
                            }}
                            autoFocus
                            className="w-full bg-neutral-900/80 border border-neutral-700 rounded-md px-2 py-1 text-sm font-serif focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </form>
                      ) : (
                        <button
                          onClick={() => onSelect(chat.id)}
                          className="flex-1 text-left"
                          aria-label={`Open chat ${chat.title}`}
                        >
                          <div>
                            <div className="font-medium font-serif text-sm text-neutral-100 truncate">
                              {chat.title}
                            </div>
                            {chat.lastMessage && (
                              <div className="text-xs text-neutral-500 truncate mt-1">
                                {chat.lastMessage}
                              </div>
                            )}
                          </div>
                        </button>
                      )}

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (isEditing) {
                              commitRename()
                            } else {
                              startRename(chat)
                            }
                          }}
                          className="p-1 rounded-md hover:bg-neutral-800/70 transition"
                          aria-label="Rename chat"
                        >
                          <PenLine className="w-4 h-4 text-neutral-300" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (window.confirm('Delete this chat? This action cannot be undone.')) {
                              onDelete(chat.id)
                            }
                          }}
                          className="p-1 rounded-md hover:bg-destructive/20 transition"
                          aria-label="Delete chat"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </button>
                      </div>
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <div className="px-4 py-3 border-t border-neutral-900 flex items-center justify-between text-xs text-neutral-500">
        <span className="font-serif tracking-wide">News Research</span>
        {onToggle && (
          <button
            onClick={onToggle}
            className="px-3 py-2 rounded-lg border border-neutral-800 hover:border-neutral-600 hover:bg-neutral-900/70 transition"
          >
            <div className="flex items-center gap-2 text-neutral-300">
              <PanelLeftClose className="w-4 h-4" />
              <span className="text-xs font-medium">Collapse</span>
            </div>
          </button>
        )}
      </div>
    </aside>
  )
}

export default ChatSidebar
