import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api'
import type { ChatConversation } from '../types'
import './Chat.css'

const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Er ging iets mis.')

interface ChatProps {
  onClose: () => void
}

export function Chat({ onClose }: ChatProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const convs = await api.friends.chats.list()
      setConversations(convs)
      if (!activeConvId && convs.length > 0) {
        setActiveConvId(convs[0].id)
      }
    } catch (err) {
      setError(message(err))
    }
  }, [activeConvId])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(t)
  }, [load])

  async function sendMessage(e: FormEvent) {
    e.preventDefault()
    if (!activeConvId || !messageText.trim()) return
    
    setBusy(true)
    setError(null)
    try {
      await api.friends.chats.sendMessage(activeConvId, messageText)
      setMessageText('')
      await load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault()
    if (!groupName.trim()) return
    
    setBusy(true)
    setError(null)
    try {
      const result = await api.friends.chats.createGroup({
        groupName,
        groupImageUrl: null,
        initialMemberIds: undefined,
      })
      setGroupName('')
      setShowGroupForm(false)
      setActiveConvId(result.conversationId)
      await load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const activeConv = conversations.find(c => c.id === activeConvId)
  const filteredConversations = conversations.filter(conv => {
    const name = conv.groupName || 'Direct bericht'
    return name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <div className="chat-container">
      {/* Sidebar */}
      <div className="chat-sidebar">
        <div className="chat-header-sidebar">
          <h2>Chats</h2>
          <div className="chat-action-buttons">
            <button className="btn-icon" title="Nieuw bericht" onClick={() => {}}>📝</button>
            <button className="btn-icon" title="Meer opties" onClick={() => {}}>⋮</button>
            <button className="btn-icon" title="Sluiten" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="chat-search">
          <input 
            type="text"
            placeholder="Zoeken op naam..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button 
          className="btn btn-sm btn-primary"
          style={{ margin: '12px', borderRadius: '20px' }}
          onClick={() => setShowGroupForm(!showGroupForm)}
        >
          + Groep
        </button>

        {showGroupForm && (
          <div className="group-creation-modal">
            <form onSubmit={createGroup} className="group-creation-form">
              <h3>Groep maken</h3>
              <div className="form-group">
                <label>Groepsnaam</label>
                <input 
                  type="text"
                  value={groupName} 
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Naam van de groep"
                  required 
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div className="group-creation-buttons">
                <button 
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setShowGroupForm(false)
                    setGroupName('')
                  }}
                >
                  Annuleren
                </button>
                <button 
                  type="submit"
                  className="btn btn-sm btn-primary" 
                  disabled={busy}
                >
                  Groep maken
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="conversations-list">
          {filteredConversations.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
              {conversations.length === 0 ? 'Geen chats' : 'Geen resultaten'}
            </div>
          ) : (
            filteredConversations.map(conv => (
              <button
                key={conv.id}
                className={`conversation-item${activeConvId === conv.id ? ' active' : ''}`}
                onClick={() => setActiveConvId(conv.id)}
              >
                <div className="conversation-item-header">
                  <p className="conversation-name">{conv.groupName || 'Direct bericht'}</p>
                  <span className="conversation-time">
                    {conv.recentMessages.length > 0
                      ? new Date(conv.recentMessages[conv.recentMessages.length - 1].sentAtUtc).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                </div>
                <p className="conversation-preview">
                  {conv.recentMessages.length > 0
                    ? `${conv.recentMessages[conv.recentMessages.length - 1].senderUsername}: ${conv.recentMessages[conv.recentMessages.length - 1].content}`
                    : 'Geen berichten'}
                </p>
              </button>
            ))
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {/* Main Chat View */}
      <div className="chat-main">
        {activeConv ? (
          <>
            <div className="chat-header-main">
              <div className="chat-info">
                <h3 className="chat-title">{activeConv.groupName || 'Direct bericht'}</h3>
                <p className="chat-subtitle">
                  {activeConv.groupMembers?.length ?? 1} deelnemers
                </p>
              </div>
              <div className="chat-action-buttons">
                <button className="btn-icon" title="Zoeken">🔍</button>
                <button className="btn-icon" title="Meer">⋮</button>
              </div>
            </div>

            <div className="chat-messages-container">
              {activeConv.recentMessages.length === 0 ? (
                <div className="messages-empty">Geen berichten. Start een gesprek!</div>
              ) : (
                activeConv.recentMessages.map((msg, idx) => {
                  const nextMsg = activeConv.recentMessages[idx + 1]
                  const showSender = !nextMsg || nextMsg.senderUsername !== msg.senderUsername
                  
                  return (
                    <div key={msg.id} className="message received">
                      {showSender && (
                        <div className="message-sender">{msg.senderUsername}</div>
                      )}
                      <div className="message-bubble">{msg.content}</div>
                      <div className="message-time">
                        {new Date(msg.sentAtUtc).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <form onSubmit={sendMessage} className="message-form-container">
              <div className="message-input-wrapper">
                <input 
                  className="message-input"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Typ een bericht..."
                  maxLength={2000}
                />
              </div>
              <button 
                className="send-button" 
                type="submit"
                disabled={busy || !messageText.trim()}
                title="Verzenden"
              >
                ➤
              </button>
            </form>
          </>
        ) : (
          <div className="messages-empty">Selecteer een chat om te starten</div>
        )}
      </div>
    </div>
  )
}
