import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Text,
  config,
  toRem,
} from 'folds';
import { Room, NotificationCountType } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { RoomAvatar } from '../../../components/room-avatar';
import { getMemberDisplayName, getNotificationType } from '../../../utils/room';
import { NotificationType } from '../../../../types/matrix/room';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { markAsRead } from '../../../utils/notifications';
import { UnreadBadge } from '../../../components/unread-badge';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { BackRouteHandler } from '../../../components/BackRouteHandler';
import { mDirectAtom } from '../../../state/mDirectList';
import { SequenceCard } from '../../../components/sequence-card';
import * as css from './Unread.css';

interface UnreadRoomItem {
  roomId: string;
  room: Room;
  unreadCount: number;
  highlightCount: number;
  lastMessage: {
    sender: string;
    senderName: string;
    body: string;
    timestamp: number;
  } | null;
}

function getLastMessagePreview(room: Room): UnreadRoomItem['lastMessage'] {
  const timeline = room.getLiveTimeline();
  const events = timeline.getEvents();
  
  // Find last message event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.getType() === 'm.room.message' && !event.isRedacted()) {
      const content = event.getContent();
      const sender = event.getSender() || '';
      return {
        sender,
        senderName: getMemberDisplayName(room, sender) || sender.split(':')[0].substring(1),
        body: content.body || '',
        timestamp: event.getTs(),
      };
    }
  }
  return null;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function UnreadRoomCard({
  item,
  isSelected,
  onMarkRead,
  onKeepUnread,
  onOpen,
  isDM,
}: {
  item: UnreadRoomItem;
  isSelected: boolean;
  onMarkRead: () => void;
  onKeepUnread: () => void;
  onOpen: () => void;
  isDM: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  return (
    <SequenceCard
      ref={cardRef}
      className={css.UnreadCard({ selected: isSelected })}
      variant={isSelected ? 'Primary' : 'SurfaceVariant'}
      direction="Column"
      gap="200"
    >
      <Box alignItems="Center" gap="300">
        <RoomAvatar
          roomId={item.roomId}
          src={item.room.getAvatarFallbackMember()?.getMxcAvatarUrl() || item.room.getMxcAvatarUrl()}
          alt={item.room.name || 'Room'}
          size="300"
        />
        <Box grow="Yes" direction="Column" gap="100">
          <Box alignItems="Center" gap="200">
            <Text size="T300" truncate priority="400">
              {isDM ? item.room.name?.replace(/^@/, '') : item.room.name || 'Unknown Room'}
            </Text>
            <UnreadBadge
              highlight={item.highlightCount > 0}
              count={item.unreadCount}
            />
          </Box>
          {item.lastMessage && (
            <Text size="T200" truncate priority="300">
              <Text as="span" size="T200" priority="400">
                {item.lastMessage.senderName}:
              </Text>{' '}
              {item.lastMessage.body.slice(0, 80)}
              {item.lastMessage.body.length > 80 ? '...' : ''}
            </Text>
          )}
        </Box>
        {item.lastMessage && (
          <Text size="T200" priority="300">
            {formatRelativeTime(item.lastMessage.timestamp)}
          </Text>
        )}
      </Box>
      <Box justifyContent="End" gap="200">
        <Button size="300" variant="Secondary" radii="300" onClick={onOpen}>
          <Text size="B300">Open</Text>
        </Button>
        <Button size="300" variant="Secondary" radii="300" onClick={onKeepUnread}>
          <Text size="B300">Skip</Text>
        </Button>
        <Button size="300" variant="Primary" radii="300" onClick={onMarkRead}>
          <Text size="B300">Mark Read</Text>
        </Button>
      </Box>
    </SequenceCard>
  );
}

export function Unread() {
  const mx = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const { navigateRoom } = useRoomNavigate();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [skippedRoomIds, setSkippedRoomIds] = useState<Set<string>>(new Set());

  // Build list of unread rooms with same filtering as notifications
  const unreadItems = useMemo(() => {
    const items: UnreadRoomItem[] = [];
    const allRoomIds = new Set(allRooms);

    roomToUnread.forEach((unread, roomId) => {
      if (!allRoomIds.has(roomId)) return;
      if (skippedRoomIds.has(roomId)) return;

      const room = mx.getRoom(roomId);
      if (!room) return;
      if (room.isSpaceRoom()) return;

      // Apply same notification filtering rules
      const notificationType = getNotificationType(mx, roomId);
      if (notificationType === NotificationType.Mute) return;
      if (notificationType === NotificationType.MentionsAndKeywords && unread.highlight === 0) return;

      const total = unread.total;
      const highlight = unread.highlight;
      if (total === 0 && highlight === 0) return;

      items.push({
        roomId,
        room,
        unreadCount: total,
        highlightCount: highlight,
        lastMessage: getLastMessagePreview(room),
      });
    });

    // Sort by oldest first (chronological order)
    items.sort((a, b) => {
      const aTime = a.lastMessage?.timestamp || 0;
      const bTime = b.lastMessage?.timestamp || 0;
      return aTime - bTime;
    });

    return items;
  }, [mx, roomToUnread, allRooms, skippedRoomIds]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, unreadItems.length - 1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
        case 'o':
          e.preventDefault();
          if (unreadItems[selectedIndex]) {
            navigateRoom(unreadItems[selectedIndex].roomId);
          }
          break;
        case 'm':
          e.preventDefault();
          if (e.shiftKey) {
            // Mark all as read
            unreadItems.forEach((item) => markAsRead(mx, item.roomId));
          } else if (unreadItems[selectedIndex]) {
            markAsRead(mx, unreadItems[selectedIndex].roomId);
            // Keep selection in bounds
            if (selectedIndex >= unreadItems.length - 1) {
              setSelectedIndex(Math.max(0, unreadItems.length - 2));
            }
          }
          break;
        case 'u':
        case 's':
          e.preventDefault();
          if (unreadItems[selectedIndex]) {
            setSkippedRoomIds((prev) => new Set([...prev, unreadItems[selectedIndex].roomId]));
            if (selectedIndex >= unreadItems.length - 1) {
              setSelectedIndex(Math.max(0, unreadItems.length - 2));
            }
          }
          break;
        case 'Escape':
          setSelectedIndex(0);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mx, unreadItems, selectedIndex, navigateRoom]);

  // Keep selection in bounds when list changes
  useEffect(() => {
    if (selectedIndex >= unreadItems.length) {
      setSelectedIndex(Math.max(0, unreadItems.length - 1));
    }
  }, [unreadItems.length, selectedIndex]);

  const handleMarkRead = useCallback(
    (roomId: string) => {
      markAsRead(mx, roomId);
    },
    [mx]
  );

  const handleKeepUnread = useCallback((roomId: string) => {
    setSkippedRoomIds((prev) => new Set([...prev, roomId]));
  }, []);

  const handleOpen = useCallback(
    (roomId: string) => {
      navigateRoom(roomId);
    },
    [navigateRoom]
  );

  const handleMarkAllRead = useCallback(() => {
    unreadItems.forEach((item) => markAsRead(mx, item.roomId));
  }, [mx, unreadItems]);

  const mobile = screenSize === ScreenSize.Mobile;

  return (
    <Page>
      <PageHeader>
        <Box grow="Yes" justifyContent="Center" alignItems="Center" gap="200">
          {mobile && (
            <BackRouteHandler>
              {(onBack) => (
                <IconButton onClick={onBack} size="300" radii="300">
                  <Icon src={Icons.ArrowLeft} size="100" />
                </IconButton>
              )}
            </BackRouteHandler>
          )}
          <Box grow="Yes" justifyContent="Center" alignItems="Center" gap="200">
            <Text size="H4" truncate>
              Unread
            </Text>
          </Box>
          {unreadItems.length > 0 && (
            <Button size="300" variant="Secondary" radii="300" onClick={handleMarkAllRead}>
              <Text size="B300">Mark All Read</Text>
            </Button>
          )}
        </Box>
      </PageHeader>
      <PageContent>
        <PageContentCenter>
          <Box direction="Column" gap="400">
            {unreadItems.length === 0 ? (
              <Box
                direction="Column"
                alignItems="Center"
                justifyContent="Center"
                gap="400"
                style={{ padding: toRem(40) }}
              >
                <Icon src={Icons.Check} size="400" />
                <Text size="H5">All caught up! 🎉</Text>
                <Text size="T200" priority="300">
                  No unread messages
                </Text>
              </Box>
            ) : (
              <>
                <Text size="T200" priority="300">
                  {unreadItems.length} room{unreadItems.length !== 1 ? 's' : ''} with unread messages
                </Text>
                <Box direction="Column" gap="200">
                  {unreadItems.map((item, index) => (
                    <UnreadRoomCard
                      key={item.roomId}
                      item={item}
                      isSelected={index === selectedIndex}
                      onMarkRead={() => handleMarkRead(item.roomId)}
                      onKeepUnread={() => handleKeepUnread(item.roomId)}
                      onOpen={() => handleOpen(item.roomId)}
                      isDM={mDirects.has(item.roomId)}
                    />
                  ))}
                </Box>
                <Box justifyContent="Center" gap="200">
                  <Text size="T200" priority="300">
                    ↑/↓ or j/k navigate • Enter open • m mark read • s skip
                  </Text>
                </Box>
              </>
            )}
          </Box>
        </PageContentCenter>
      </PageContent>
    </Page>
  );
}
