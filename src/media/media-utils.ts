import { GenesysCloudWebrtcSdk } from '../client';
import { IExtendedMediaSession, ISessionAndConversationIds } from '../types/interfaces';

const GC_AUDIO_EL_CLASS = '__gc-webrtc-inbound';

export let _hasTransceiverFunctionality: boolean;

/**
 * Select or create the `audio.__gc-webrtc-inbound` element
 */
export const getOrCreateAudioMediaElement = function (): HTMLAudioElement {
  const existing = document.querySelector(`audio.${GC_AUDIO_EL_CLASS}`);
  if (existing) {
    return existing as HTMLAudioElement;
  }
  const audio = document.createElement('audio');
  audio.classList.add(GC_AUDIO_EL_CLASS);
  (audio.style as any) = 'visibility: hidden';

  document.body.append(audio);
  return audio;
};

/**
 * Attach an audio stream to the given audio element. 
 *  If no element is provided, a new element will be 
 *  created and attached to the DOM. 
 * 
 * @param sdk sdk instance
 * @param stream audio stream to attach
 * @param audioElement optional audio element to attach stream to
 * @param ids session and/or conversation Ids for logging
 */
export const attachAudioMedia = function (
  sdk: GenesysCloudWebrtcSdk,
  stream: MediaStream,
  audioElement?: HTMLAudioElement,
  ids?: ISessionAndConversationIds
): HTMLAudioElement {
  if (!audioElement) {
    audioElement = getOrCreateAudioMediaElement();
  }

  if (audioElement.srcObject) {
    sdk.logger.warn('Attaching media to an audio element that already has a srcObject. This can result is audio issues.', ids);
  }

  audioElement.autoplay = true;
  audioElement.srcObject = stream;
  return audioElement;
};

/**
 * Utility method to check if the browser supports 
 *  RTC transceivers. 
 */
export const checkHasTransceiverFunctionality = function (): boolean {
  if (typeof _hasTransceiverFunctionality === 'boolean') {
    return _hasTransceiverFunctionality;
  }

  try {
    /* make sure we are capable to use tracks */
    const dummyRtcPeerConnection = new RTCPeerConnection();
    /* if this function exists we should be good */
    _hasTransceiverFunctionality = !!dummyRtcPeerConnection.getTransceivers;
    dummyRtcPeerConnection.close();
  } catch (err) {
    _hasTransceiverFunctionality = false;
  }
  return _hasTransceiverFunctionality;
};

/**
 * Utility method to check all tracks on a given stream
 *  to determine if all tracks have ended. 
 * @param stream to check tracks on
 */
export const checkAllTracksHaveEnded = function (stream: MediaStream): boolean {
  let allTracksHaveEnded = true;
  stream.getTracks().forEach(function (t) {
    allTracksHaveEnded = t.readyState === 'ended' && allTracksHaveEnded;
  });
  return allTracksHaveEnded;
};

/**
 * Utility method to create a new stream and add 
 *  the passed in track
 * @param track media track to add
 */
export const createNewStreamWithTrack = function (track: MediaStreamTrack): MediaStream {
  const newStream = new MediaStream();
  newStream.addTrack(track);
  return newStream;
};

export type LogDevicesAction =
  /* devices used on session start */
  'sessionStarted' |
  /* when a function to update any type of media is called */
  'calledToChangeDevices' |
  /* right before media is updated */
  'changingDevices' |
  /* called after media has been updated successfully */
  'successfullyChangedDevices' |
  /* called right before unmuting video (since we have to spin up new media) */
  'unmutingVideo';

/**
 * Utility to log device changes. It will use the passed in `from` track _or_
 *  look up the currently used devices via the sender (based on labels) to see
 *  what device is currently in use. Then it will log out the device changing `to`
 *  as the new device.
 *
 * NOTE: if the system default is being used and then changes (which will force
 *  devices to be enumerated) the device will not be able to be looked up in the
 *  cached devices. So the caller will need to pass in the "old" system default(s)
 *  as `fromVideoTrack` and/or `fromAudioTrack`.
 *
 * @param sdk sdk instance
 * @param session session devices are changing for
 * @param action action taken
 * @param devicesChange devices changing to/from
 */
export function logDeviceChange (
  sdk: GenesysCloudWebrtcSdk,
  session: IExtendedMediaSession,
  action: LogDevicesAction,
  devicesChange: {
    toVideoTrack?: MediaStreamTrack;
    toAudioTrack?: MediaStreamTrack;
    fromVideoTrack?: MediaStreamTrack;
    fromAudioTrack?: MediaStreamTrack;
    requestedOutputDeviceId?: string;
    requestedVideoDeviceId?: string | boolean;
    requestedAudioDeviceId?: string | boolean;
    requestedNewMediaStream?: MediaStream;
  } = {}
): void {
  let currentVideoTrack: MediaStreamTrack;
  let currentAudioTrack: MediaStreamTrack;
  const currentOutputDeviceId: string = session._outputAudioElement?.sinkId;
  const screenShareTrackId = session._screenShareStream?.getVideoTracks()[0]?.id;
  const pcSenders = session.pc.getSenders().filter(s => s.track && s.track.id && s.track.id !== screenShareTrackId);

  /* grab the currect device being used */
  pcSenders.forEach(sender => {
    if (sender.track.kind === 'audio') {
      currentAudioTrack = sender.track;
    } else /* if (sender.track.kind === 'video') */ {
      currentVideoTrack = sender.track;
    }
  });

  const mediaState = sdk.media.getState();
  const details = {
    /* meta data */
    action,
    availableDevices: mediaState.devices,
    sessionId: session.id,
    conversationId: session.conversationId,

    /* the device being switched from and/or currently being used.
      if a track was passed in, we will assume the caller knows what it is doing
      and we will use that track for logging. Otherwise, we will look up the device */
    currentVideoDevice: devicesChange.fromVideoTrack
      ? { deviceId: undefined, groupId: undefined, label: devicesChange.fromVideoTrack.label }
      : sdk.media.findCachedDeviceByTrackLabel(currentVideoTrack),
    currentAudioDevice: devicesChange.fromAudioTrack
      ? { deviceId: undefined, groupId: undefined, label: devicesChange.fromAudioTrack.label }
      : sdk.media.findCachedDeviceByTrackLabel(currentAudioTrack),
    currentOutputDevice: sdk.media.findCachedOutputDeviceById(currentOutputDeviceId),

    /* current tracks */
    currentVideoTrack,
    currentAudioTrack,

    /* the device being switched to */
    newVideoDevice: sdk.media.findCachedDeviceByTrackLabel(devicesChange.toVideoTrack),
    newAudioDevice: sdk.media.findCachedDeviceByTrackLabel(devicesChange.toAudioTrack),
    newOutputDevice: sdk.media.findCachedOutputDeviceById(devicesChange.requestedOutputDeviceId),

    /* the track being switched to */
    newVideoTrack: devicesChange.toVideoTrack,
    newAudioTrack: devicesChange.toAudioTrack,

    /* potential media streamTracks we _want_ to switch to */
    requestedNewMediaStreamTracks: devicesChange.requestedNewMediaStream?.getTracks(),

    /* deviceIds requested */
    requestedOutputDeviceId: devicesChange.requestedOutputDeviceId,
    requestedVideoDeviceId: devicesChange.requestedVideoDeviceId,
    requestedAudioDeviceId: devicesChange.requestedAudioDeviceId,

    /* sdk defaults */
    sdkDefaultVideoDeviceId: sdk._config.defaults.videoDeviceId,
    sdkDefaultAudioDeviceId: sdk._config.defaults.audioDeviceId,
    sdkDefaultOutputDeviceId: sdk._config.defaults.outputDeviceId,

    /* other random stuff */
    currentAudioElementSinkId: currentOutputDeviceId,
    currentSessionSenderTracks: pcSenders.map(s => s.track),
    currentSessionReceiverTracks: session.pc.getReceivers().filter(s => s.track && s.track.id).map(s => s.track),

    /* other potentially useful information to log */
    sessionVideoMute: session.videoMuted,
    sessionAudioMute: session.audioMuted,
    hasMicPermissions: mediaState.hasMicPermissions,
    hasCameraPermissions: mediaState.hasCameraPermissions,
    hasOutputDeviceSupport: mediaState.hasOutputDeviceSupport
  };

  const keysToIgnoreIfBlank: Array<keyof typeof details> = [
    'newVideoTrack',
    'newAudioTrack',
    'requestedAudioDeviceId',
    'requestedVideoDeviceId',
    'requestedOutputDeviceId',
    'requestedNewMediaStreamTracks'
  ];

  /* trim off parts of logs that aren't needed if they are blank */
  Object.keys(details)
    .filter(k => keysToIgnoreIfBlank.includes(k as keyof typeof details))
    .forEach(k => {
      if (details[k] === undefined) {
        delete details[k];
      }
    });

  sdk.logger.info('media devices changing for session', details);
}
