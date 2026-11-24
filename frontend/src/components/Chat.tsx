import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api'
import type { ChatConversation, FriendMe } from '../types'
import { initial } from '../friendsUi'

const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Er ging iets mis.')

interface ChatProps {
  me: FriendMe
  onClose: () => void
}

function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  return (
    <span className={`avatar`} style={{ width: size, height: size }} title={name}>
      {src ? <img src={src} alt={name} /> : <span>{initial(name)}</span>}
    </span>
  )
}

export function Chat({ me, onClose }: ChatProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')

  const load = useCallback(async () => {
    try {
      const convs = await api.friends.chats.list()
      setConversations(convs)
      if (activeConvId && !convs.some(c => c.id === activeConvId)) {
        setActiveConvId(convs[0]?.id ?? null)
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
  const title = activeConv?.groupName || (activeConv ? 'Direct bericht' : 'Chat')

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>{title}</h2>
        <button className="btn btn-sm" onClick={onClose}>Sluiten</button>
      </div>

      <div className="chat-container">
        <div className="chat-list">
          <button 
            className="btn btn-sm btn-primary" 
            onClick={() => setShowGroupForm(!showGroupForm)}
          >
            {showGroupForm ? 'Annuleren' : 'Groep maken'}
          </button>

          {showGroupForm && (
            <form onSubmit={createGroup} className="group-form">
              <label>
                Groepsnaam
                <input 
                  className="input" 
                  value={groupName} 
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Naam van de groep"
                  required 
                  maxLength={200}
                />
              </label>
              <button className="btn btn-sm btn-primary" disabled={busy}>Groep maken</button>
            </form>
          )}

          <div className="conversations">
            {conversations.map(conv => (
              <button
                key={conv.id}
                className={`conversation-item${activeConvId === conv.id ? ' active' : ''}`}
                onClick={() => setActiveConvId(conv.id)}
              >
                <strong>{conv.groupName || 'Direct bericht'}</strong>
                <span className="muted">
                  {conv.recentMessages.length > 0 
                    ? conv.recentMessages[conv.recentMessages.length - 1].content.substring(0, 50)
                    : 'Geen berichten'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="chat-view">
          {activeConv ? (
            <>
              <div className="chat-messages">
                {activeConv.recentMessages.map(msg => (
                  <div key={msg.id} className="message">
                    <strong>{msg.senderUsername}</strong>
                    <p>{msg.content}</p>
                    <span className="muted">
                      {new Date(msg.sentAtUtc).toLocaleString('nl-BE')}
                    </span>
                  </div>
                ))}
              </div>
              <form onSubmit={sendMessage} className="message-form">
                <input 
                  className="input" 
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Typ een bericht..."
                  maxLength={2000}
                />
                <button className="btn btn-sm btn-primary" disabled={busy}>Verzenden</button>
              </form>
            </>
          ) : (
            <div className="empty">Selecteer een chat</div>
          )}
        </div>
      </div>

      {error && <div className="banner" role="alert">{error}</div>}
    </div>
  )
}
