import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api'
import type { ChatConversation, FriendMe } from '../types'
import './Chat.css'

const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Er ging iets mis.')

interface ChatProps {
  me: FriendMe | null
}

export function Chat({ me }: ChatProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [showDirectForm, setShowDirectForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddMembers, setShowAddMembers] = useState(false)
  const [friendsToAdd, setFriendsToAdd] = useState<string[]>([])
  const [allFriends, setAllFriends] = useState<Array<{ id: string; username: string }>>([])

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

  // Load friends on component mount
  useEffect(() => {
    const loadFriends = async () => {
      try {
        const overview = await api.friends.overview()
        setAllFriends(overview.friends.map(f => ({ id: f.id, username: f.username })))
      } catch (err) {
        console.error('Failed to load friends:', err)
      }
    }
    void loadFriends()
  }, [])

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

  async function addMembersToGroup(e: FormEvent) {
    e.preventDefault()
    if (!activeConvId || friendsToAdd.length === 0) return

    setBusy(true)
    setError(null)
    try {
      // friendsToAdd contains usernames, not IDs
      for (const friendId of friendsToAdd) {
        const friend = allFriends.find(f => f.id === friendId)
        if (friend) {
          await api.friends.chats.addMember(activeConvId, friend.username)
        }
      }
      setFriendsToAdd([])
      setShowAddMembers(false)
      await load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function createDirectChat(friendId: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await api.friends.chats.createDirect(friendId)
      setActiveConvId(result.conversationId)
      await load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const activeConv = conversations.find(c => c.id === activeConvId)
  const isGroupChat = activeConv?.groupName !== undefined && activeConv?.groupName !== null
  const filteredConversations = conversations.filter(conv => {
    const name = conv.groupName || 'Direct bericht'
    return name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  // Get friends not already in the group
  const availableFriendsToAdd = allFriends.filter(
    f => !activeConv?.groupMembers?.includes(f.id) && f.username !== me?.username
  )

  return (
    <div className="chat-container">
      {/* Sidebar */}
      <div className="chat-sidebar">
        <div className="chat-header-sidebar">
          <h2>Chats</h2>
          <div className="chat-action-buttons">
            <button className="btn btn-sm" onClick={() => setShowDirectForm(!showDirectForm)}>Nieuw bericht</button>
            <button className="btn btn-sm btn-primary" onClick={() => setShowGroupForm(!showGroupForm)}>Nieuwe groep</button>
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

        {showGroupForm && (
          <div className="modal-overlay">
            <form onSubmit={createGroup} className="modal-content">
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
              <div className="form-buttons">
                <button 
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowGroupForm(false)
                    setGroupName('')
                  }}
                >
                  Annuleren
                </button>
                <button 
                  type="submit"
                  className="btn btn-primary" 
                  disabled={busy}
                >
                  Groep maken
                </button>
              </div>
            </form>
          </div>
        )}

        {showDirectForm && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Bericht sturen naar vrienden</h3>
              <div className="form-group">
                <label>Selecteer een vriend:</label>
                <div className="friend-select-list">
                  {allFriends.length === 0 ? (
                    <div style={{ padding: '12px', color: 'var(--muted)', textAlign: 'center' }}>
                      Je hebt nog geen vrienden
                    </div>
                  ) : (
                    allFriends.map(friend => (
                      <button
                        key={friend.id}
                        type="button"
                        className="friend-select-item"
                        onClick={() => createDirectChat(friend.id).then(() => setShowDirectForm(false))}
                        style={{ display: 'flex', justifyContent: 'space-between' }}
                      >
                        <span>{friend.username}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="form-buttons">
                <button 
                  type="button"
                  className="btn"
                  onClick={() => setShowDirectForm(false)}
                >
                  Sluiten
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="conversations-list">
          {filteredConversations.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>
              {conversations.length === 0 ? 'Geen chats' : 'Geen resultaten'}
            </div>
          ) : (
            filteredConversations.map(conv => (
              <button
                key={conv.id}
                className={`conversation-item${activeConvId === conv.id ? ' active' : ''}`}
                onClick={() => setActiveConvId(conv.id)}
              >
                <div className="conversation-item-wrapper">
                  {/* Avatar section */}
                  {conv.directChatFriend ? (
                    <div className="conversation-avatar-section">
                      {conv.directChatFriend.avatar ? (
                        <img 
                          src={conv.directChatFriend.avatar} 
                          alt={conv.directChatFriend.username}
                          className="conversation-avatar"
                        />
                      ) : (
                        <div className="conversation-avatar-placeholder">
                          {conv.directChatFriend.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Content section */}
                  <div className="conversation-item-content">
                    <div className="conversation-item-header">
                      <p className="conversation-name">
                        {conv.groupName || conv.directChatFriend?.username || 'Direct bericht'}
                      </p>
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
                  </div>
                </div>
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
                  {activeConv.groupMembers?.length ?? 1} deelnemer{activeConv.groupMembers && activeConv.groupMembers.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="chat-header-actions">
                {isGroupChat && (
                  <button 
                    className="btn btn-primary"
                    onClick={() => setShowAddMembers(!showAddMembers)}
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                  >
                    Leden toevoegen
                  </button>
                )}
              </div>
            </div>

            {showAddMembers && availableFriendsToAdd.length > 0 && (
              <form onSubmit={addMembersToGroup} className="modal-overlay">
                <div className="modal-content">
                  <h3>Vrienden toevoegen</h3>
                  
                  {friendsToAdd.length > 0 && (
                    <div className="selected-friends">
                      {friendsToAdd.map(friendId => {
                        const friend = allFriends.find(f => f.id === friendId)
                        return (
                          <div key={friendId} className="friend-badge">
                            {friend?.username}
                            <button
                              type="button"
                              onClick={() => setFriendsToAdd(friendsToAdd.filter(f => f !== friendId))}
                            >
                              Verwijder
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="form-group">
                    <label>Selecteer vrienden:</label>
                    <div className="friend-select-list">
                      {availableFriendsToAdd.map(friend => (
                        <label key={friend.id} className="friend-select-item">
                          <input
                            type="checkbox"
                            checked={friendsToAdd.includes(friend.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFriendsToAdd([...friendsToAdd, friend.id])
                              } else {
                                setFriendsToAdd(friendsToAdd.filter(f => f !== friend.id))
                              }
                            }}
                          />
                          <span>{friend.username}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="form-buttons">
                    <button 
                      type="button"
                      className="btn"
                      onClick={() => {
                        setShowAddMembers(false)
                        setFriendsToAdd([])
                      }}
                    >
                      Annuleren
                    </button>
                    <button 
                      type="submit"
                      className="btn btn-primary" 
                      disabled={busy || friendsToAdd.length === 0}
                    >
                      Toevoegen ({friendsToAdd.length})
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="chat-messages-container">
              {activeConv.recentMessages.length === 0 ? (
                <div className="messages-empty">Geen berichten. Start een gesprek!</div>
              ) : (
                activeConv.recentMessages.map((msg, idx) => {
                  const nextMsg = activeConv.recentMessages[idx + 1]
                  const isSentByMe = msg.sentByUserId === me?.id
                  const isLastInSequence = !nextMsg || nextMsg.senderUsername !== msg.senderUsername
                  
                  return (
                    <div key={msg.id} className={`message ${isSentByMe ? 'sent' : 'received'}`}>
                      <div className="message-content">
                        <div className="message-bubble">{msg.content}</div>
                        {isLastInSequence && (
                          <div className="message-meta">
                            <span className="message-time">
                              {new Date(msg.sentAtUtc).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="message-sender">{msg.senderUsername}</span>
                          </div>
                        )}
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
                Verstuur
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
