import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { Box, Scroll, Text, config, toRem } from 'folds';
import { Room, Direction, MatrixEvent } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useSetting } from '../../../state/hooks/settings';
import { MessageLayout, settingsAtom } from '../../../state/settings';
import { useMatrixEventRenderer } from '../../../hooks/useMatrixEventRenderer';
import { Message, Reactions, Event, EncryptedContent } from '../../../features/room/message';
import {
  DefaultPlaceholder,
  CompactPlaceholder,
  Reply,
  MessageBase,
  Time,
  MessageNotDecryptedContent,
  RedactedContent,
  MSticker,
  ImageContent,
  EventContent,
  MessageUnsupportedContent,
} from '../../../components/message';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { Image } from '../../../components/media';
import { ImageViewer } from '../../../components/image-viewer';
import {
  getEventReactions,
  getMemberDisplayName,
  getEditedEvent,
  isMembershipChanged,
  reactionOrEditEvent,
} from '../../../utils/room';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../../types/matrix/room';
import { getMxIdLocalPart } from '../../../utils/matrix';
import { useMemberEventParser } from '../../../hooks/useMemberEventParser';
import { usePowerLevelsContext } from '../../../hooks/usePowerLevels';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../../plugins/react-custom-html-parser';
import { useMentionClickHandler } from '../../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../../hooks/useSpoilerClickHandler';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { useImagePackRooms } from '../../../hooks/useImagePackRooms';
import { useIsDirectRoom } from '../../../hooks/useRoom';
import { inSameDay, minuteDifference, today, yesterday, timeDayMonthYear } from '../../../utils/time';
import { Badge, Line } from 'folds';
import { color } from 'folds';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../../hooks/useMemberPowerTag';
import { useTheme } from '../../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../../hooks/usePowerLevelTags';
import * as customHtmlCss from '../../../styles/CustomHtml.css';
import { Icons } from 'folds';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts as LinkifyOpts } from 'linkifyjs';

const TimelineDivider = ({ variant, children }: { variant?: string; children: React.ReactNode }) => (
  <Box gap="100" justifyContent="Center" alignItems="Center">
    <Line style={{ flexGrow: 1 }} variant={variant as any} size="300" />
    {children}
    <Line style={{ flexGrow: 1 }} variant={variant as any} size="300" />
  </Box>
);

interface ReadOnlyTimelineProps {
  room: Room;
}

export function ReadOnlyTimeline({ room }: ReadOnlyTimelineProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [messageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [messageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const direct = useIsDirectRoom();
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
  const theme = useTheme();
  const accessiblePowerTagColors = useAccessiblePowerTagColors(theme.kind, creatorsTag, powerLevelTags);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canSendReaction = permissions.event(MessageEvent.Reaction, mx.getSafeUserId());
  const canPinEvent = permissions.stateEvent(StateEvent.RoomPinnedEvents, mx.getSafeUserId());
  const canRedact = permissions.action('redact', mx.getSafeUserId());

  const roomToParents = useAtomValue(roomToParentsAtom);
  const imagePackRooms: Room[] = useImagePackRooms(room.roomId, roomToParents);
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();
  const parseMemberEvent = useMemberEventParser();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pagination state
  const [isPaginating, setIsPaginating] = useState(false);
  const [hasPaginated, setHasPaginated] = useState(false);
  const [, forceUpdate] = useState({});

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room, mentionClickHandler]
  );

  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [mx, room, linkifyOpts, spoilerClickHandler, mentionClickHandler, useAuthentication]
  );

  // Load messages if needed
  useEffect(() => {
    const loadMessages = async () => {
      if (hasPaginated) return;
      
      const timeline = room.getLiveTimeline();
      const events = timeline.getEvents();
      const paginationToken = timeline.getPaginationToken(Direction.Backward);
      
      const messageCount = events.filter(e => 
        e.getType() === 'm.room.message' || e.getType() === 'm.room.encrypted'
      ).length;
      
      if (messageCount < 10 && paginationToken) {
        setIsPaginating(true);
        try {
          await mx.paginateEventTimeline(timeline, {
            backwards: true,
            limit: 50,
          });
          forceUpdate({});
        } catch (err) {
          console.error('[ReadOnlyTimeline] Failed to paginate:', err);
        }
        setIsPaginating(false);
      }
      setHasPaginated(true);
    };
    
    loadMessages();
  }, [mx, room, hasPaginated]);

  // Get events
  const events = useMemo(() => {
    const timeline = room.getLiveTimeline();
    const timelineSet = timeline.getTimelineSet();
    const allEvents = timeline.getEvents();
    
    // Filter to renderable events
    return allEvents.filter(e => {
      const type = e.getType();
      if (reactionOrEditEvent(e)) return false;
      return type === 'm.room.message' || 
             type === 'm.room.encrypted' || 
             type === 'm.sticker' ||
             type === 'm.room.member';
    }).slice(-30); // Last 30 events
  }, [room, hasPaginated]);

  // Scroll to bottom on load
  useEffect(() => {
    if (scrollRef.current && !isPaginating) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, isPaginating]);

  const timelineSet = room.getLiveTimeline().getTimelineSet();

  // Render a single event
  const renderEvent = (mEvent: MatrixEvent, index: number, prevEvent?: MatrixEvent) => {
    const mEventId = mEvent.getId();
    if (!mEventId) return null;

    const eventType = mEvent.getType();
    const senderId = mEvent.getSender() ?? '';
    const senderDisplayName = getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;

    // Check for day divider
    const showDayDivider = prevEvent ? !inSameDay(prevEvent.getTs(), mEvent.getTs()) : false;

    // Check for message collapse
    const collapsed = prevEvent &&
      !showDayDivider &&
      prevEvent.getSender() === senderId &&
      prevEvent.getType() === eventType &&
      minuteDifference(prevEvent.getTs(), mEvent.getTs()) < 2;

    const dayDividerJSX = showDayDivider ? (
      <MessageBase space={messageSpacing}>
        <TimelineDivider variant="Surface">
          <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
            <Text size="L400">
              {(() => {
                if (today(mEvent.getTs())) return 'Today';
                if (yesterday(mEvent.getTs())) return 'Yesterday';
                return timeDayMonthYear(mEvent.getTs());
              })()}
            </Text>
          </Badge>
        </TimelineDivider>
      </MessageBase>
    ) : null;

    // Handle member events
    if (eventType === 'm.room.member') {
      const membershipChanged = isMembershipChanged(mEvent);
      if (membershipChanged && hideMembershipEvents) return dayDividerJSX;
      if (!membershipChanged && hideNickAvatarEvents) return dayDividerJSX;

      const parsed = parseMemberEvent(mEvent);
      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <React.Fragment key={mEventId}>
          {dayDividerJSX}
          <Event
            data-message-item={index}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={false}
            messageSpacing={messageSpacing}
            canDelete={false}
            hideReadReceipts={true}
            showDeveloperTools={false}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={parsed.icon}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    {parsed.body}
                  </Text>
                </Box>
              }
            />
          </Event>
        </React.Fragment>
      );
    }

    // Handle message events
    const reactionRelations = getEventReactions(timelineSet, mEventId);
    const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
    const hasReactions = reactions && reactions.length > 0;
    const { replyEventId, threadRootId } = mEvent;
    const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
    const getContent = (() =>
      editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent()) as GetContentCallback;

    // For encrypted messages
    if (eventType === 'm.room.encrypted') {
      return (
        <React.Fragment key={mEventId}>
          {dayDividerJSX}
          <Message
            data-message-item={index}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapsed}
            highlight={false}
            canDelete={false}
            canSendReaction={false}
            canPinEvent={false}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={false}
                  onReactionToggle={() => {}}
                />
              )
            }
            hideReadReceipts={true}
            showDeveloperTools={false}
            memberPowerTag={getMemberPowerTag(senderId)}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            <EncryptedContent mEvent={mEvent}>
              {() => {
                if (mEvent.isRedacted()) return <RedactedContent />;
                if (mEvent.getType() === MessageEvent.RoomMessage) {
                  const clearContent = mEvent.getClearContent();
                  const content = clearContent || mEvent.getContent();
                  return (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      msgType={content.msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      getContent={() => content}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                    />
                  );
                }
                return (
                  <Text>
                    <MessageNotDecryptedContent />
                  </Text>
                );
              }}
            </EncryptedContent>
          </Message>
        </React.Fragment>
      );
    }

    // Regular message
    return (
      <React.Fragment key={mEventId}>
        {dayDividerJSX}
        <Message
          data-message-item={index}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          messageSpacing={messageSpacing}
          messageLayout={messageLayout}
          collapse={collapsed}
          highlight={false}
          canDelete={false}
          canSendReaction={false}
          canPinEvent={false}
          imagePackRooms={imagePackRooms}
          relations={hasReactions ? reactionRelations : undefined}
          reply={
            replyEventId && (
              <Reply
                room={room}
                timelineSet={timelineSet}
                replyEventId={replyEventId}
                threadRootId={threadRootId}
                onClick={() => {}}
                getMemberPowerTag={getMemberPowerTag}
                accessibleTagColors={accessiblePowerTagColors}
                legacyUsernameColor={legacyUsernameColor || direct}
              />
            )
          }
          reactions={
            reactionRelations && (
              <Reactions
                style={{ marginTop: config.space.S200 }}
                room={room}
                relations={reactionRelations}
                mEventId={mEventId}
                canSendReaction={false}
                onReactionToggle={() => {}}
              />
            )
          }
          hideReadReceipts={true}
          showDeveloperTools={false}
          memberPowerTag={getMemberPowerTag(senderId)}
          accessibleTagColors={accessiblePowerTagColors}
          legacyUsernameColor={legacyUsernameColor || direct}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        >
          {mEvent.isRedacted() ? (
            <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
          ) : (
            <RenderMessageContent
              displayName={senderDisplayName}
              msgType={mEvent.getContent().msgtype ?? ''}
              ts={mEvent.getTs()}
              edited={!!editedEvent}
              getContent={getContent}
              mediaAutoLoad={mediaAutoLoad}
              urlPreview={showUrlPreview}
              htmlReactParserOptions={htmlReactParserOptions}
              linkifyOpts={linkifyOpts}
              outlineAttachment={messageLayout === MessageLayout.Bubble}
            />
          )}
        </Message>
      </React.Fragment>
    );
  };

  return (
    <Scroll ref={scrollRef} visibility="Auto" style={{ height: '100%' }}>
      <Box
        direction="Column"
        style={{ minHeight: '100%', padding: `${config.space.S400} 0` }}
      >
        {isPaginating && (
          <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
            <Text size="T200" priority="300">Loading messages...</Text>
          </Box>
        )}
        {events.map((event, index) => renderEvent(event, index, events[index - 1]))}
        {events.length === 0 && !isPaginating && (
          <Box justifyContent="Center" alignItems="Center" style={{ padding: config.space.S600 }}>
            <Text size="T200" priority="300">No messages to display</Text>
          </Box>
        )}
      </Box>
    </Scroll>
  );
}
