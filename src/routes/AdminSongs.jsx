import React, { useEffect, useState, useCallback } from 'react';
import { FiTrash2, FiPlus, FiMusic, FiSearch, FiLink, FiDisc, FiMic, FiAlertCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';
import {
  Card, PageHeader, Btn, Tag, Empty, SkeletonRows,
  Th, Td, Tr, TableWrap, Modal, Input, FormRow, ModalFooter, Cover
} from './AdminUI';
import { songDefaults } from '../../utils/songUtils';

const fmt = (s) => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—';

const iStyle = {
  width:'100%',background:'#0a0a0a',border:'1px solid #1f1f1f',borderRadius:8,
  padding:'8px 12px',color:'#f9fafb',fontSize:13,outline:'none',
  fontFamily:'inherit',transition:'border-color .12s',
};

const AdminSongs = ({ api }) => {
  const [songs,   setSongs  ] = useState([]);
  const [albums,  setAlbums ] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch ] = useState('');
  const [filter,  setFilter ] = useState('all');

  // Add song modal
  const [showAdd, setShowAdd] = useState(false);
  const [saving,  setSaving ] = useState(false);
  const [form, setForm] = useState({ title:'', audiourl:'', cover_url:'', duration_seconds:'', artist_id:'', album_id:'' });

  // Map modal state
  const [mapModal,    setMapModal   ] = useState(null);  // { song, type:'album'|'artist' }
  const [mapAlbumId,  setMapAlbumId ] = useState('');
  const [mapArtistId, setMapArtistId] = useState('');
  const [mapSearch,   setMapSearch  ] = useState('');
  const [mapping,     setMapping    ] = useState(false);

  /* ── fetch ── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, al, ar] = await Promise.all([
        api.get('/songs'),
        api.get('/albums'),
        api.get('/artists'),
      ]);
      setSongs(s.data);
      setAlbums(al.data);
      setArtists(ar.data);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── add ── */
  const handleAdd = async () => {
    if (!form.title || !form.audiourl) { toast.error('Title and audio URL required'); return; }
    setSaving(true);
    try {
      await api.post('/songs', { ...form, duration_seconds: parseInt(form.duration_seconds) || 0 });
      toast.success('Song added');
      setShowAdd(false);
      setForm({ title:'', audiourl:'', cover_url:'', duration_seconds:'', artist_id:'', album_id:'' });
      fetchAll();
    } catch { toast.error('Failed to add song'); }
    finally { setSaving(false); }
  };

  /* ── delete ── */
  const handleDelete = async (id) => {
    if (!window.confirm('Delete this song?')) return;
    try { await api.delete(`/songs/${id}`); setSongs(s => s.filter(x => x.id !== id)); toast.success('Deleted'); }
    catch { toast.error('Deletion failed'); }
  };

  /* ── open map modal ── */
  const openMap = (song, type) => {
    setMapModal({ song, type });
    setMapAlbumId(song.album_id || '');
    setMapArtistId(song.artist_id || '');
    setMapSearch('');
  };

  /* ── save mapping ── */
  const saveMapping = async () => {
    if (!mapModal) return;
    setMapping(true);
    try {
      const payload = mapModal.type === 'album'
        ? { album_id: mapAlbumId || null }
        : { artist_id: mapArtistId || null };

      await api.patch(`/songs/${mapModal.song.id}`, payload);

      setSongs(prev => prev.map(s => {
        if (s.id !== mapModal.song.id) return s;
        if (mapModal.type === 'album') {
          const al = albums.find(a => a.id === mapAlbumId);
          return { ...s, album_id: mapAlbumId || null, album_title: al?.title || null };
        }
        const ar = artists.find(a => a.id === mapArtistId);
        return { ...s, artist_id: mapArtistId || null, artist_name: ar?.name || null };
      }));

      toast.success(mapModal.type === 'album' ? 'Album mapped ✓' : 'Artist mapped ✓');
      setMapModal(null);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Mapping failed');
    } finally { setMapping(false); }
  };

  /* ── derived ── */
  const filtered = songs.filter(s => {
    const q = search.toLowerCase();
    const matchQ = !q || s.title?.toLowerCase().includes(q) ||
      s.artist_name?.toLowerCase().includes(q) ||
      s.album_title?.toLowerCase().includes(q);
    const matchF =
      filter === 'no-album'  ? !s.album_id  :
      filter === 'no-artist' ? !s.artist_id : true;
    return matchQ && matchF;
  });

  const unmappedAlbum  = songs.filter(s => !s.album_id).length;
  const unmappedArtist = songs.filter(s => !s.artist_id).length;

  const filteredAlbums  = albums.filter(a =>
    !mapSearch || a.title?.toLowerCase().includes(mapSearch.toLowerCase()) ||
    a.artist_name?.toLowerCase().includes(mapSearch.toLowerCase()));
  const filteredArtists = artists.filter(a =>
    !mapSearch || a.name?.toLowerCase().includes(mapSearch.toLowerCase()));

  /* ═══════════════════════════════════════════════════════════════════ */
  return (
    <div>
      <PageHeader
        title="Songs"
        subtitle={`${songs.length} tracks in catalog`}
        action={<Btn icon={FiPlus} onClick={() => setShowAdd(true)}>Add Song</Btn>}
      />

      {/* Unmapped banners */}
      {(unmappedAlbum > 0 || unmappedArtist > 0) && (
        <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
          {unmappedAlbum > 0 && (
            <div onClick={() => setFilter(f => f==='no-album' ? 'all' : 'no-album')}
              style={{
                display:'flex',alignItems:'center',gap:8,padding:'7px 14px',
                borderRadius:8,cursor:'pointer',transition:'all .12s',
                background: filter==='no-album' ? 'rgba(245,158,11,.12)' : 'rgba(245,158,11,.06)',
                border:`1px solid ${filter==='no-album' ? 'rgba(245,158,11,.4)' : 'rgba(245,158,11,.2)'}`,
              }}>
              <FiAlertCircle size={13} style={{ color:'#f59e0b' }}/>
              <span style={{ fontSize:12,color:'#f59e0b',fontWeight:600 }}>
                {unmappedAlbum} song{unmappedAlbum!==1?'s':''} without album
                {filter==='no-album' ? ' — click to show all' : ' — click to filter'}
              </span>
            </div>
          )}
          {unmappedArtist > 0 && (
            <div onClick={() => setFilter(f => f==='no-artist' ? 'all' : 'no-artist')}
              style={{
                display:'flex',alignItems:'center',gap:8,padding:'7px 14px',
                borderRadius:8,cursor:'pointer',transition:'all .12s',
                background: filter==='no-artist' ? 'rgba(167,139,250,.12)' : 'rgba(167,139,250,.06)',
                border:`1px solid ${filter==='no-artist' ? 'rgba(167,139,250,.4)' : 'rgba(167,139,250,.2)'}`,
              }}>
              <FiAlertCircle size={13} style={{ color:'#a78bfa' }}/>
              <span style={{ fontSize:12,color:'#a78bfa',fontWeight:600 }}>
                {unmappedArtist} song{unmappedArtist!==1?'s':''} without artist
                {filter==='no-artist' ? ' — click to show all' : ' — click to filter'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Search + filter */}
      <Card style={{ marginBottom:16 }} p={14}>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ position:'relative', flex:1, minWidth:200 }}>
            <FiSearch size={13} style={{ position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',color:'#374151' }}/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search songs, artists, albums..."
              style={{ ...iStyle, paddingLeft:30, fontSize:12 }}
              onFocus={e=>e.target.style.borderColor='#ec4899'}
              onBlur={e=>e.target.style.borderColor='#1f1f1f'}
            />
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {[
              { id:'all',       label:'All'       },
              { id:'no-album',  label:'No Album'  },
              { id:'no-artist', label:'No Artist' },
            ].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                padding:'5px 12px',borderRadius:6,cursor:'pointer',fontFamily:'inherit',
                border:`1px solid ${filter===f.id ? '#ec4899' : '#1a1a1a'}`,
                background: filter===f.id ? 'rgba(236,72,153,.1)' : 'transparent',
                color: filter===f.id ? '#ec4899' : '#4b5563',
                fontSize:11,fontWeight:600,letterSpacing:'.04em',transition:'all .12s',
              }}>{f.label}</button>
            ))}
          </div>
        </div>
      </Card>

      {/* Table */}
      <TableWrap>
        <thead>
          <tr>
            <Th>Track</Th><Th>Artist</Th><Th>Album</Th>
            <Th>Duration</Th><Th>Plays</Th><Th right>Actions</Th>
          </tr>
        </thead>
        {loading ? <SkeletonRows cols={6} rows={10}/> : (
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={6}><Empty message="No songs found"/></td></tr>
              : filtered.map(raw => {
                  const s = songDefaults(raw);
                  const noAlbum  = !raw.album_id;
                  const noArtist = !raw.artist_id;

                  const mapBtn = (type, noVal) => (
                    <button onClick={() => openMap(raw, type)} title={`Map ${type}`}
                      style={{
                        padding:'3px 6px',borderRadius:5,display:'inline-flex',
                        cursor:'pointer',transition:'all .12s',
                        background: noVal ? (type==='album' ? 'rgba(245,158,11,.1)' : 'rgba(167,139,250,.1)') : 'transparent',
                        border: `1px solid ${noVal ? (type==='album' ? 'rgba(245,158,11,.3)' : 'rgba(167,139,250,.3)') : 'transparent'}`,
                        color: noVal ? (type==='album' ? '#f59e0b' : '#a78bfa') : '#374151',
                      }}
                      onMouseEnter={e=>{
                        const c = type==='album'?'#f59e0b':'#a78bfa';
                        const b = type==='album'?'rgba(245,158,11,.3)':'rgba(167,139,250,.3)';
                        const bg= type==='album'?'rgba(245,158,11,.1)':'rgba(167,139,250,.1)';
                        e.currentTarget.style.color=c; e.currentTarget.style.borderColor=b; e.currentTarget.style.background=bg;
                      }}
                      onMouseLeave={e=>{
                        if (!noVal){ e.currentTarget.style.color='#374151'; e.currentTarget.style.borderColor='transparent'; e.currentTarget.style.background='transparent'; }
                      }}
                    >
                      {type==='album' ? <FiDisc size={11}/> : <FiMic size={11}/>}
                    </button>
                  );

                  return (
                    <Tr key={s.id}>
                      <Td>
                        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                          <Cover src={s.cover_url} size={34} radius={6}
                            fallback={<FiMusic size={13} style={{ color:'#374151' }}/>}/>
                          <div>
                            <p style={{ margin:0,fontSize:13,fontWeight:600,color:'#e5e7eb' }}>{s.title}</p>
                            {s.is_explicit && <Tag color="#f59e0b">Explicit</Tag>}
                          </div>
                        </div>
                      </Td>

                      <Td>
                        <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                          {noArtist ? <Tag color="#a78bfa">No Artist</Tag>
                            : <span style={{ fontSize:13,color:'#4b5563' }}>{s.artist_name}</span>}
                          {mapBtn('artist', noArtist)}
                        </div>
                      </Td>

                      <Td>
                        <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                          {noAlbum ? <Tag color="#f59e0b">No Album</Tag>
                            : <span style={{ fontSize:13,color:'#4b5563' }}>{s.album_title}</span>}
                          {mapBtn('album', noAlbum)}
                        </div>
                      </Td>

                      <Td muted>{fmt(s.duration_seconds)}</Td>
                      <Td muted>{s.play_count?.toLocaleString() || 0}</Td>
                      <Td right>
                        <button onClick={() => handleDelete(s.id)}
                          style={{ padding:'5px 8px',borderRadius:6,background:'transparent',border:'1px solid transparent',cursor:'pointer',color:'#374151',transition:'all .12s',display:'inline-flex' }}
                          onMouseEnter={e=>{ e.currentTarget.style.color='#ef4444'; e.currentTarget.style.borderColor='rgba(239,68,68,.2)'; e.currentTarget.style.background='rgba(239,68,68,.08)'; }}
                          onMouseLeave={e=>{ e.currentTarget.style.color='#374151'; e.currentTarget.style.borderColor='transparent'; e.currentTarget.style.background='transparent'; }}>
                          <FiTrash2 size={13}/>
                        </button>
                      </Td>
                    </Tr>
                  );
                })
            }
          </tbody>
        )}
      </TableWrap>

      {/* ══ ADD SONG MODAL ══════════════════════════════════════════════ */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Song">
        <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
          <Input label="Title *" value={form.title}
            onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Song title"/>
          <Input label="Audio URL *" value={form.audiourl}
            onChange={e=>setForm(p=>({...p,audiourl:e.target.value}))} placeholder="https://drive.google.com/..."/>
          <FormRow>
            <Input label="Cover Image URL" value={form.cover_url}
              onChange={e=>setForm(p=>({...p,cover_url:e.target.value}))} placeholder="https://..."/>
            <Input label="Duration (seconds)" type="number" value={form.duration_seconds}
              onChange={e=>setForm(p=>({...p,duration_seconds:e.target.value}))} placeholder="215"/>
          </FormRow>
          <FormRow>
            <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
              <label style={{ fontSize:10,color:'#4b5563',letterSpacing:'.12em',textTransform:'uppercase',fontWeight:600 }}>Artist</label>
              <select value={form.artist_id} onChange={e=>setForm(p=>({...p,artist_id:e.target.value}))}
                style={iStyle}
                onFocus={e=>e.target.style.borderColor='#ec4899'}
                onBlur={e=>e.target.style.borderColor='#1f1f1f'}>
                <option value="">— None —</option>
                {artists.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
              <label style={{ fontSize:10,color:'#4b5563',letterSpacing:'.12em',textTransform:'uppercase',fontWeight:600 }}>Album</label>
              <select value={form.album_id} onChange={e=>setForm(p=>({...p,album_id:e.target.value}))}
                style={iStyle}
                onFocus={e=>e.target.style.borderColor='#ec4899'}
                onBlur={e=>e.target.style.borderColor='#1f1f1f'}>
                <option value="">— None —</option>
                {albums.map(a=><option key={a.id} value={a.id}>{a.title}{a.artist_name ? ` (${a.artist_name})`:''}</option>)}
              </select>
            </div>
          </FormRow>
        </div>
        <ModalFooter onCancel={()=>setShowAdd(false)} onSubmit={handleAdd} loading={saving} submitLabel="Add Song"/>
      </Modal>

      {/* ══ MAP MODAL ═══════════════════════════════════════════════════ */}
      <Modal
        open={!!mapModal} onClose={()=>setMapModal(null)}
        title={mapModal ? `Map ${mapModal.type === 'album' ? 'Album' : 'Artist'} → "${mapModal.song?.title}"` : ''}
        maxWidth={520}
      >
        {mapModal && (
          <div>
            {/* Song preview card */}
            <div style={{
              display:'flex',alignItems:'center',gap:12,
              padding:'10px 14px',borderRadius:8,marginBottom:16,
              background:'#0a0a0a',border:'1px solid #1f1f1f',
            }}>
              <Cover src={mapModal.song.cover_url} size={38} radius={6}
                fallback={<FiMusic size={14} style={{ color:'#374151' }}/>}/>
              <div>
                <p style={{ margin:0,fontSize:13,fontWeight:600,color:'#e5e7eb' }}>{mapModal.song.title}</p>
                <p style={{ margin:'2px 0 0',fontSize:11,color:'#4b5563' }}>
                  Current {mapModal.type}: {mapModal.type==='album'
                    ? (mapModal.song.album_title || 'Not mapped')
                    : (mapModal.song.artist_name || 'Not mapped')}
                </p>
              </div>
            </div>

            {/* Search */}
            <div style={{ position:'relative', marginBottom:12 }}>
              <FiSearch size={12} style={{ position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',color:'#374151' }}/>
              <input value={mapSearch} onChange={e=>setMapSearch(e.target.value)} autoFocus
                placeholder={`Search ${mapModal.type}s…`}
                style={{ ...iStyle, paddingLeft:30, fontSize:12 }}
                onFocus={e=>e.target.style.borderColor='#ec4899'}
                onBlur={e=>e.target.style.borderColor='#1f1f1f'}
              />
            </div>

            {/* Clear option */}
            {(() => {
              const isClear = mapModal.type==='album' ? !mapAlbumId : !mapArtistId;
              return (
                <div onClick={()=> mapModal.type==='album' ? setMapAlbumId('') : setMapArtistId('')}
                  style={{
                    display:'flex',alignItems:'center',gap:10,
                    padding:'8px 12px',borderRadius:8,cursor:'pointer',
                    marginBottom:6,transition:'all .12s',
                    background: isClear ? 'rgba(236,72,153,.08)' : 'transparent',
                    border:`1px solid ${isClear ? 'rgba(236,72,153,.25)' : '#1f1f1f'}`,
                  }}
                  onMouseEnter={e=>{ if(!isClear) e.currentTarget.style.background='#111'; }}
                  onMouseLeave={e=>{ if(!isClear) e.currentTarget.style.background='transparent'; }}
                >
                  <div style={{ width:32,height:32,borderRadius:6,background:'#1a1a1a',border:'1px solid #2a2a2a',display:'flex',alignItems:'center',justifyContent:'center' }}>
                    <FiLink size={12} style={{ color:'#4b5563' }}/>
                  </div>
                  <div>
                    <p style={{ margin:0,fontSize:13,fontWeight:500,color:'#9ca3af' }}>
                      Remove {mapModal.type} mapping
                    </p>
                    <p style={{ margin:0,fontSize:10,color:'#374151' }}>Set to unassigned</p>
                  </div>
                  {isClear && <span style={{ marginLeft:'auto',width:8,height:8,borderRadius:'50%',background:'#ec4899' }}/>}
                </div>
              );
            })()}

            {/* List */}
            <div style={{ maxHeight:300, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
              {(mapModal.type==='album' ? filteredAlbums : filteredArtists).length === 0 && (
                <p style={{ textAlign:'center',fontSize:13,color:'#374151',padding:'20px 0' }}>
                  No {mapModal.type}s found
                </p>
              )}
              {mapModal.type === 'album'
                ? filteredAlbums.map(al => {
                    const sel = mapAlbumId === al.id;
                    return (
                      <div key={al.id} onClick={()=>setMapAlbumId(al.id)}
                        style={{
                          display:'flex',alignItems:'center',gap:10,
                          padding:'8px 12px',borderRadius:8,cursor:'pointer',transition:'all .12s',
                          background: sel ? 'rgba(236,72,153,.08)' : 'transparent',
                          border:`1px solid ${sel ? 'rgba(236,72,153,.25)' : 'transparent'}`,
                        }}
                        onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#111'; }}
                        onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent'; }}
                      >
                        <Cover src={al.cover_url} size={32} radius={5}
                          fallback={<FiDisc size={11} style={{ color:'#374151' }}/>}/>
                        <div style={{ flex:1,minWidth:0 }}>
                          <p style={{ margin:0,fontSize:13,fontWeight:600,color:'#e5e7eb',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                            {al.title}
                          </p>
                          <p style={{ margin:0,fontSize:11,color:'#4b5563' }}>
                            {al.artist_name || 'Unknown Artist'} · {al.song_count || 0} tracks
                          </p>
                        </div>
                        {sel && <span style={{ width:8,height:8,borderRadius:'50%',background:'#ec4899',flexShrink:0 }}/>}
                      </div>
                    );
                  })
                : filteredArtists.map(ar => {
                    const sel = mapArtistId === ar.id;
                    return (
                      <div key={ar.id} onClick={()=>setMapArtistId(ar.id)}
                        style={{
                          display:'flex',alignItems:'center',gap:10,
                          padding:'8px 12px',borderRadius:8,cursor:'pointer',transition:'all .12s',
                          background: sel ? 'rgba(167,139,250,.08)' : 'transparent',
                          border:`1px solid ${sel ? 'rgba(167,139,250,.25)' : 'transparent'}`,
                        }}
                        onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#111'; }}
                        onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent'; }}
                      >
                        <Cover src={ar.image_url} size={32} radius={16}
                          fallback={<FiMic size={11} style={{ color:'#374151' }}/>}/>
                        <div style={{ flex:1,minWidth:0 }}>
                          <p style={{ margin:0,fontSize:13,fontWeight:600,color:'#e5e7eb',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                            {ar.name}
                          </p>
                          <p style={{ margin:0,fontSize:11,color:'#4b5563' }}>{ar.song_count || 0} songs</p>
                        </div>
                        {sel && <span style={{ width:8,height:8,borderRadius:'50%',background:'#a78bfa',flexShrink:0 }}/>}
                      </div>
                    );
                  })
              }
            </div>
          </div>
        )}
        <ModalFooter
          onCancel={()=>setMapModal(null)}
          onSubmit={saveMapping}
          loading={mapping}
          submitLabel={mapModal?.type==='album' ? 'Save Album Mapping' : 'Save Artist Mapping'}
        />
      </Modal>
    </div>
  );
};

export default AdminSongs;
