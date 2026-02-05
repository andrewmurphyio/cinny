/* Message preview component for Unread page using existing Cinny rendering */
import React, { useMemo } from 'react';
import { MatrixEvent, Room, RelationType, EventType } from 'matrix-js-sdk';
import { Box, Text, config, toRem } from 'folds';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMemberDisplayName, getEditedEvent, getEventReactions } from '../../../utils/room';
import { getMxIdLocalPart } from '../../../utils/matrix';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../../plugins/react-custom-html-parser';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { GetContentCallback, MessageEvent } from '../../../../types/matrix/room';
import { useMatrixEventRenderer } from '../../../hooks/useMatrixEventRenderer';
import * as customHtmlCss from '../../../styles/CustomHtml.css';
import {
  AvatarBase,
  ImageContent,
  MSticker,
  MessageNotDecryptedContent,
  MessageUnsupportedContent,
  ModernLayout,
  RedactedContent,
  Time,
  Username,
  Reaction,
} from '../../../components/message';
import { Image } from '../../../components/media';
import { ImageViewer } from '../../../components/image-viewer';
import { EncryptedContent } from '../../../features/room/message';
import { useMentionClickHandler } from '../../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../../hooks/useSpoilerClickHandler';
import { UserAvatar } from '../../../components/user-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import colorMXID from '../../../../util/colorMXID';

type UnreadMessagesProps = {
  room: Room;
  events: MatrixEvent[];
};

export function UnreadMessages({ room, events }: UnreadMessagesProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');

  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();

  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [mx, room.roomId, mentionClickHandler, spoilerClickHandler]
  );

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room.roomId, mentionClickHandler]
  );

  const renderMatrixEvent = useMatrixEventRenderer<[MatrixEvent, string, GetContentCallback]>(
    {
      [MessageEvent.RoomMessage]: (mEvent, displayName, getContent) => {
        if (mEvent.isRedacted()) {
          return <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content?.reason} />;
        }
        return (
          <RenderMessageContent
            displayName={displayName}
            msgType={mEvent.getContent().msgtype ?? ''}
            ts={mEvent.getTs()}
            getContent={getContent}
            mediaAutoLoad={mediaAutoLoad}
            urlPreview={urlPreview}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
            outlineAttachment
          />
        );
      },
      [MessageEvent.RoomMessageEncrypted]: (mEvent, displayName) => {
        return (
          <EncryptedContent mEvent={mEvent}>
            {() => {
              if (mEvent.isRedacted()) return <RedactedContent />;
              if (mEvent.getType() === MessageEvent.Sticker) {
                return (
                  <MSticker
                    content={mEvent.getContent()}
                    renderImageContent={(props) => (
                      <ImageContent
                        {...props}
                        autoPlay={mediaAutoLoad}
                        renderImage={(p) => <Image {...p} loading="lazy" />}
                        renderViewer={(p) => <ImageViewer {...p} />}
                      />
                    )}
                  />
                );
              }
              if (mEvent.getType() === MessageEvent.RoomMessage) {
                const getContent = (() => mEvent.getContent()) as GetContentCallback;
                return (
                  <RenderMessageContent
                    displayName={displayName}
                    msgType={mEvent.getContent().msgtype ?? ''}
                    ts={mEvent.getTs()}
                    getContent={getContent}
                    mediaAutoLoad={mediaAutoLoad}
                    urlPreview={urlPreview}
                    htmlReactParserOptions={htmlReactParserOptions}
                    linkifyOpts={linkifyOpts}
                  />
                );
              }
              return <MessageNotDecryptedContent />;
            }}
          </EncryptedContent>
        );
      },
      [MessageEvent.Sticker]: (mEvent, displayName, getContent) => {
        if (mEvent.isRedacted()) {
          return <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content?.reason} />;
        }
        return (
          <MSticker
            content={getContent()}
            renderImageContent={(props) => (
              <ImageContent
                {...props}
                autoPlay={mediaAutoLoad}
                renderImage={(p) => <Image {...p} loading="lazy" />}
                renderViewer={(p) => <ImageViewer {...p} />}
              />
            )}
          />
        );
      },
    },
    undefined,
    (mEvent) => {
      if (mEvent.isRedacted()) {
        return <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content?.reason} />;
      }
      return (
        <Text size="T300" priority="300">
          <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
        </Text>
      );
    }
  );

  const formatTime = (ts: number) => {
    const now = Date.now();
    const diff = now - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Box direction="Column" gap="200">
      {events.map((mEvent) => {
        const senderId = mEvent.getSender() || '';
        const displayName = getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
        const getContent = (() => mEvent.getContent()) as GetContentCallback;
        const eventId = mEvent.getId();
        
        // Get reactions for this event
        const timelineSet = room.getUnfilteredTimelineSet();
        const reactionRelations = eventId ? getEventReactions(timelineSet, eventId) : undefined;
        const reactions = reactionRelations?.getSortedAnnotationsByKey() ?? [];
        
        return (
          <Box key={eventId} direction="Column" gap="100" style={{ paddingBottom: toRem(8), borderBottom: '1px solid var(--bg-surface-container-low)' }}>
            <Box alignItems="Center" gap="200">
              <UserAvatar
                userId={senderId}
                src={undefined}
                alt={displayName}
                size="200"
                renderFallback={() => (
                  <Text size="T200" style={{ color: colorMXID(senderId) }}>
                    {displayName.slice(0, 2).toUpperCase()}
                  </Text>
                )}
              />
              <Text size="T200" priority="400" style={{ color: colorMXID(senderId) }}>
                {displayName}
              </Text>
              <Text size="T100" priority="300">
                {formatTime(mEvent.getTs())}
              </Text>
            </Box>
            <Box style={{ paddingLeft: toRem(32) }} direction="Column" gap="100">
              {renderMatrixEvent(mEvent.getType(), false, mEvent, displayName, getContent)}
              {reactions.length > 0 && (
                <Box gap="100" wrap="Wrap" style={{ marginTop: toRem(4) }}>
                  {reactions.map(([key, events]) => (
                    <Box
                      key={key}
                      alignItems="Center"
                      gap="100"
                      style={{
                        padding: `${toRem(2)} ${toRem(8)}`,
                        backgroundColor: 'var(--bg-surface-container-low)',
                        borderRadius: toRem(12),
                        fontSize: toRem(12),
                      }}
                    >
                      <Text size="T200">{key}</Text>
                      <Text size="T100" priority="300">{events.size}</Text>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
