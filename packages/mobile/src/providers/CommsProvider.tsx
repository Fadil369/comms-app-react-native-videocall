import type {
  ConferenceStatusUpdatedEventType,
  ParticipantChangedEventType,
  StreamChangedEventType,
  PermissionsUpdatedEventType,
} from '@dolbyio/comms-sdk-react-native/lib/typescript/services/conference/events';
import type {
  ParticipantInfo,
  Conference,
  ConferenceJoinOptions,
  Participant,
  UnsubscribeFunction,
  ConferenceStatus,
} from '@dolbyio/comms-sdk-react-native/lib/typescript/services/conference/models';
import React, { createContext, useState, useEffect, useMemo, ReactElement, useCallback } from 'react';
import { Platform } from 'react-native';

import conferenceService from '../services/conference';
import sdkService from '../services/sdk';
import sessionService from '../services/session';

type CommsContext = {
  setMicPermissions: React.Dispatch<React.SetStateAction<boolean>>;
  setCameraPermissions: React.Dispatch<React.SetStateAction<boolean>>;
  openSession: (participantInfo: ParticipantInfo) => Promise<void>;
  closeSession: () => void;
  joinConference: (conference: Conference, options: ConferenceJoinOptions) => Promise<void>;
  leaveConference: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  addIsSpeakingListener: (participant: Participant) => () => void;
  muteParticipant: (participant: Participant, isMuted: boolean) => void;
  micPermissions: boolean;
  cameraPermissions: boolean;
  user: Participant | null;
  conference: Conference | null;
  participants: Participant[];
  isMuted: boolean;
  isVideo: boolean;
  participantsIsSpeaking: Record<string, boolean>;
  participantsIsMuted: Record<string, boolean>;
  participantsIsVideoEnabled: Record<string, boolean>;
  conferenceStatus: ConferenceStatus | null;
  isPageMuted: boolean;
  toggleMuteParticipants: () => void;
};

type CommsProviderProps = {
  children: ReactElement;
  token: string;
  refreshToken: () => Promise<string>;
};

export const CommsContext = createContext<CommsContext>({} as CommsContext);

const CommsProvider: React.FC<CommsProviderProps> = ({ children, token, refreshToken }) => {
  const isMutedDefault = false;
  const isVideoDefault = true;
  const isPageMutedDefault = false;
  const [micPermissions, setMicPermissions] = useState(Platform.OS !== 'android');
  const [cameraPermissions, setCameraPermissions] = useState(Platform.OS !== 'android');
  const [user, setUser] = useState<CommsContext['user']>(null);
  const [conference, setConference] = useState<CommsContext['conference']>(null);
  const [participantsIsSpeaking, setParticipantsIsSpeaking] = useState<CommsContext['participantsIsSpeaking']>({});
  const [participantsIsMuted, setParticipantsIsMuted] = useState<CommsContext['participantsIsMuted']>({});
  const [participantsIsVideoEnabled, setParticipantsIsVideoEnabled] = useState<
    CommsContext['participantsIsVideoEnabled']
  >({});
  const [isMuted, setIsMuted] = useState<CommsContext['isMuted']>(isMutedDefault);
  const [isVideo, setIsVideo] = useState<CommsContext['isVideo']>(isVideoDefault);
  const [conferenceStatus, setConferenceStatus] = useState<CommsContext['conferenceStatus']>(null);
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPageMuted, setIsPageMuted] = useState(isPageMutedDefault);

  // INITIALIZATION

  useEffect(() => {
    (async () => {
      if (token && refreshToken) {
        await sdkService.initializeToken(token, refreshToken);
        setIsInitialized(true);
      } else {
        setIsInitialized(true);
        // eslint-disable-next-line no-console
        console.log('No initialization params passed');
      }
    })();
  }, [token, refreshToken]);

  // CHECK INIT MUTED STATE

  useEffect(() => {
    (async () => {
      const value = await conferenceService.isMuted();
      if (user) {
        conferenceService.mute(user, value);
        setIsMuted(value);
      }
    })();
  }, []);

  // SESSION METHODS

  const openSession = async (participantInfo: ParticipantInfo) => {
    const timeoutPromise = setTimeout(async () => {
      await sessionService.close();
    }, 5000);
    try {
      await sessionService.open(participantInfo);
      clearTimeout(timeoutPromise);
      setUser(await sessionService.getUser());
    } catch {
      clearTimeout(timeoutPromise);
      setUser(null);
    }
  };

  const closeSession = () => {
    participants.clear();
    setIsMuted(isMutedDefault);
    setIsVideo(isVideoDefault);
    setIsPageMuted(isPageMutedDefault);
    sessionService.close();
  };

  // CONFERENCE METHODS

  const joinConference = useCallback(async (conference: Conference, joinOptions: ConferenceJoinOptions) => {
    const joinedConference = await conferenceService.join(conference, joinOptions);
    setConference(joinedConference);
  }, []);

  const leaveConference = useCallback(async () => {
    await conferenceService.leave();
    setConference(null);
  }, []);

  const addIsSpeakingListener = (participant: Participant) => {
    const interval = setInterval(async () => {
      const isSpeaking = await conferenceService.isSpeaking(participant);
      setParticipantsIsSpeaking((state) => ({
        ...state,
        [participant.id]: isSpeaking,
      }));
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  };

  // PARTICIPANT METHODS

  const toggleMute = () => {
    if (user) {
      conferenceService.mute(user, !isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = async () => {
    if (user) {
      setIsVideo(!isVideo);
      if (isVideo) {
        await conferenceService.stopVideo(user);
      } else {
        await conferenceService.startVideo(user);
      }
    }
  };

  const muteParticipant = (participant: Participant, mute: boolean) => {
    setParticipantsIsMuted((state) => ({
      ...state,
      [participant.id]: mute,
    }));

    // For Dolby Voice use startAudio/stopAudio to mute/unmute a participant.
    return mute ? conferenceService.stopAudio(participant) : conferenceService.startAudio(participant);
  };

  const participantsArray = useMemo(() => {
    return Array.from(participants.values());
  }, [participants]);

  const toggleMuteParticipants = async () => {
    const onlyRemoteNotMutedParticipants = participantsArray.filter((p: Participant) => p.id !== user?.id);
    try {
      await Promise.all(
        onlyRemoteNotMutedParticipants.map(async (participant) => {
          return muteParticipant(participant, !isPageMuted);
        }),
      );
      setIsPageMuted((prevState) => !prevState);
    } catch (e) {
      console.log('Error muting all participants', e);
    }
  };

  // ADDING EVENT HANDLERS

  const onConferenceStatusChange = (data: ConferenceStatusUpdatedEventType) => {
    setConferenceStatus(data.status);
  };

  const onParticipantsChange = (data: ParticipantChangedEventType) => {
    setParticipants((participants) => new Map(participants.set(data.participant.id, data.participant)));
  };

  const onStreamsChange = (data: StreamChangedEventType) => {
    const { participant } = data;
    const isVideoEnabled = participant.streams[participant.streams.length - 1]?.videoTracks.length > 0;
    setParticipantsIsVideoEnabled((state) => ({
      ...state,
      [participant.id]: isVideoEnabled,
    }));

    setParticipants((participants) => {
      const p = participants.get(participant.id);
      if (p) {
        return new Map(participants.set(p.id, { ...p, streams: participant.streams }));
      }
      return participants;
    });
  };

  const onPermissionsChange = (data: PermissionsUpdatedEventType) => {
    // eslint-disable-next-line no-console
    console.log('PERMISSIONS UPDATED EVENT DATA: \n', JSON.stringify(data, null, 2));
  };

  useEffect(() => {
    return conferenceService.onParticipantsChange((data) => {
      setParticipants((participants) => new Map(participants.set(data.participant.id, data.participant)));
    });
  }, []);

  useEffect(() => {
    const unsubscribers: UnsubscribeFunction[] = [
      conferenceService.onStatusChange(onConferenceStatusChange),
      conferenceService.onParticipantsChange(onParticipantsChange),
      conferenceService.onStreamsChange(onStreamsChange),
      conferenceService.onPermissionsChange(onPermissionsChange),
    ];
    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, []);

  const contextValue: CommsContext = useMemo(
    () => ({
      micPermissions,
      setMicPermissions,
      cameraPermissions,
      setCameraPermissions,
      openSession,
      closeSession,
      joinConference,
      leaveConference,
      user,
      conference,
      participants: participantsArray,
      isMuted,
      toggleMute,
      addIsSpeakingListener,
      participantsIsSpeaking,
      participantsIsMuted,
      participantsIsVideoEnabled,
      muteParticipant,
      conferenceStatus,
      isVideo,
      toggleVideo,
      isPageMuted,
      toggleMuteParticipants,
    }),
    [
      micPermissions,
      cameraPermissions,
      isInitialized,
      user,
      conference,
      participants,
      isMuted,
      participantsIsSpeaking,
      participantsIsVideoEnabled,
      conferenceStatus,
      isVideo,
      toggleVideo,
      isPageMuted,
      toggleMuteParticipants,
    ],
  );

  return <CommsContext.Provider value={contextValue}>{isInitialized ? children : null}</CommsContext.Provider>;
};

export default CommsProvider;