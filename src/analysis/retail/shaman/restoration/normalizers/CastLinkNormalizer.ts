import EventLinkNormalizer, { EventLink } from 'parser/core/EventLinkNormalizer';
import {
  AbilityEvent,
  ApplyBuffEvent,
  CastEvent,
  EventType,
  GetRelatedEvents,
  HasRelatedEvent,
  HealEvent,
  RefreshBuffEvent,
  RemoveBuffEvent,
} from 'parser/core/Events';
import { Options } from 'parser/core/Module';
import talents from 'common/TALENTS/shaman';
import {
  APPLIED_HEAL,
  PRIMAL_TIDE_CORE,
  HARDCAST,
  RIPTIDE_PWAVE,
  HEALING_WAVE_PWAVE,
  PWAVE_REMOVAL,
  CAST_BUFFER_MS,
  PWAVE_TRAVEL_MS,
  HEALING_RAIN_DURATION,
  HEALING_RAIN,
  OVERFLOWING_SHORES,
  HEALING_RAIN_GROUPING,
  CHAIN_HEAL,
  CHAIN_HEAL_GROUPING,
  FLOW_OF_THE_TIDES,
  DOWNPOUR,
} from '../constants';
import SPELLS from 'common/SPELLS';

/*
  This file is for attributing the various sources of spell applications to their respective abilities and talents.
  It is needed because there are certain abilities that can have multiple sources based on talents, 
  i.e. riptide -> primorial wave & primal tide core
*/
const EVENT_LINKS: EventLink[] = [
  //Riptide linking
  {
    linkRelation: HARDCAST,
    linkingEventId: [talents.RIPTIDE_TALENT.id],
    linkingEventType: [EventType.ApplyBuff, EventType.RefreshBuff, EventType.Heal],
    referencedEventId: [talents.RIPTIDE_TALENT.id],
    referencedEventType: [EventType.Cast],
    forwardBufferMs: CAST_BUFFER_MS,
    backwardBufferMs: CAST_BUFFER_MS,
    isActive(c) {
      //extremely unlikely but you never know
      return c.hasTalent(talents.RIPTIDE_TALENT);
    },
  },
  {
    linkRelation: RIPTIDE_PWAVE,
    reverseLinkRelation: APPLIED_HEAL,
    linkingEventId: [talents.RIPTIDE_TALENT.id],
    linkingEventType: [EventType.ApplyBuff, EventType.RefreshBuff, EventType.Heal],
    referencedEventId: [talents.PRIMORDIAL_WAVE_TALENT.id],
    referencedEventType: [EventType.Cast],
    forwardBufferMs: PWAVE_TRAVEL_MS,
    backwardBufferMs: PWAVE_TRAVEL_MS,
    additionalCondition(referencedEvent) {
      return (referencedEvent as CastEvent).targetIsFriendly;
    },
    isActive(c) {
      return c.hasTalent(talents.PRIMORDIAL_WAVE_TALENT);
    },
  },
  {
    linkRelation: PRIMAL_TIDE_CORE,
    linkingEventId: [talents.RIPTIDE_TALENT.id],
    linkingEventType: [EventType.ApplyBuff, EventType.Heal],
    referencedEventId: [talents.RIPTIDE_TALENT.id],
    referencedEventType: [EventType.ApplyBuff, EventType.RefreshBuff],
    anyTarget: true,
    maximumLinks: 1,
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    additionalCondition(linkingEvent, referencedEvent) {
      return (
        (linkingEvent as ApplyBuffEvent).targetID !==
          (referencedEvent as ApplyBuffEvent).targetID &&
        (linkingEvent as ApplyBuffEvent).sourceID ===
          (referencedEvent as ApplyBuffEvent).sourceID &&
        !HasRelatedEvent(linkingEvent, HARDCAST) &&
        !HasRelatedEvent(linkingEvent, RIPTIDE_PWAVE)
      );
    },
    isActive(c) {
      return c.hasTalent(talents.PRIMAL_TIDE_CORE_TALENT);
    },
  },
  //Healing Wave linking - necessary for pwave
  {
    linkRelation: HARDCAST,
    reverseLinkRelation: HARDCAST,
    linkingEventId: [talents.HEALING_WAVE_TALENT.id],
    linkingEventType: [EventType.Heal],
    referencedEventId: [talents.HEALING_WAVE_TALENT.id],
    referencedEventType: [EventType.Cast],
    maximumLinks: 1,
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
  },
  {
    linkRelation: HEALING_WAVE_PWAVE,
    linkingEventId: [talents.HEALING_WAVE_TALENT.id],
    linkingEventType: [EventType.Heal],
    referencedEventId: [talents.HEALING_WAVE_TALENT.id],
    referencedEventType: [EventType.Cast],
    anyTarget: true,
    backwardBufferMs: PWAVE_TRAVEL_MS,
    forwardBufferMs: PWAVE_TRAVEL_MS,
    additionalCondition(linkingEvent, referencedEvent) {
      return (
        !HasRelatedEvent(linkingEvent, HARDCAST) &&
        (linkingEvent as HealEvent).sourceID === (referencedEvent as CastEvent).sourceID
      );
    },
    isActive(c) {
      return c.hasTalent(talents.PRIMORDIAL_WAVE_TALENT);
    },
  },
  {
    linkRelation: PWAVE_REMOVAL,
    linkingEventId: [SPELLS.PRIMORDIAL_WAVE_BUFF.id],
    linkingEventType: [EventType.RemoveBuff],
    referencedEventId: [talents.HEALING_WAVE_TALENT.id],
    referencedEventType: [EventType.Cast],
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    anyTarget: true,
    isActive(c) {
      return c.hasTalent(talents.PRIMORDIAL_WAVE_TALENT);
    },
  },
  //healing rain linking
  {
    linkRelation: HEALING_RAIN,
    reverseLinkRelation: HEALING_RAIN,
    linkingEventId: [SPELLS.HEALING_RAIN_HEAL.id],
    linkingEventType: EventType.Heal,
    referencedEventId: [talents.HEALING_RAIN_TALENT.id],
    referencedEventType: EventType.Cast,
    backwardBufferMs: HEALING_RAIN_DURATION,
    forwardBufferMs: CAST_BUFFER_MS,
    anyTarget: true,
    isActive(c) {
      return c.hasTalent(talents.HEALING_RAIN_TALENT);
    },
    additionalCondition(linkingEvent, referencedEvent) {
      return (linkingEvent as HealEvent).sourceID === (referencedEvent as CastEvent).sourceID;
    },
  },
  //group healing rain ticks together for targets hit analysis
  {
    linkRelation: HEALING_RAIN_GROUPING,
    linkingEventId: [SPELLS.HEALING_RAIN_HEAL.id],
    linkingEventType: EventType.Heal,
    referencedEventId: [SPELLS.HEALING_RAIN_HEAL.id],
    referencedEventType: EventType.Heal,
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    anyTarget: true,
    isActive(c) {
      return c.hasTalent(talents.HEALING_RAIN_TALENT);
    },
    additionalCondition(linkingEvent, referencedEvent) {
      return (
        (linkingEvent as HealEvent).sourceID === (referencedEvent as HealEvent).sourceID &&
        (linkingEvent as HealEvent).targetID !== (referencedEvent as HealEvent).targetID
      );
    },
  },
  {
    linkRelation: OVERFLOWING_SHORES,
    reverseLinkRelation: OVERFLOWING_SHORES,
    linkingEventId: [SPELLS.OVERFLOWING_SHORES_HEAL.id],
    linkingEventType: EventType.Heal,
    referencedEventId: [talents.HEALING_RAIN_TALENT.id],
    referencedEventType: EventType.Cast,
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    anyTarget: true,
    isActive(c) {
      return (
        c.hasTalent(talents.HEALING_RAIN_TALENT) && c.hasTalent(talents.OVERFLOWING_SHORES_TALENT)
      );
    },
    additionalCondition(linkingEvent, referencedEvent) {
      return (linkingEvent as HealEvent).sourceID === (referencedEvent as CastEvent).sourceID;
    },
  },
  //chain heal
  //group heal events together for targets hit analysis and order normalizing
  {
    linkRelation: CHAIN_HEAL_GROUPING,
    linkingEventId: [talents.CHAIN_HEAL_TALENT.id],
    linkingEventType: EventType.Heal,
    referencedEventId: [talents.CHAIN_HEAL_TALENT.id],
    referencedEventType: EventType.Heal,
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    anyTarget: true,
      additionalCondition(linkingEvent, referencedEvent) {
      return (linkingEvent as HealEvent).sourceID === (referencedEvent as CastEvent).sourceID;
    },
  },
  //link cast to heals
  {
    linkRelation: CHAIN_HEAL,
    reverseLinkRelation: CHAIN_HEAL,
    linkingEventId: [talents.CHAIN_HEAL_TALENT.id],
    linkingEventType: EventType.Heal,
    referencedEventId: [talents.CHAIN_HEAL_TALENT.id],
    referencedEventType: EventType.Cast,
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    anyTarget: true,
      additionalCondition(linkingEvent, referencedEvent) {
      return (linkingEvent as HealEvent).sourceID === (referencedEvent as CastEvent).sourceID;
    },
  },
  //link riptide removal to chain heal for fotd
  {
    linkRelation: FLOW_OF_THE_TIDES,
    reverseLinkRelation: FLOW_OF_THE_TIDES,
    linkingEventId: [talents.RIPTIDE_TALENT.id],
    linkingEventType: [EventType.RemoveBuff],
    referencedEventId: [talents.CHAIN_HEAL_TALENT.id],
    referencedEventType: [EventType.Cast],
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    isActive(c) {
      return c.hasTalent(talents.FLOW_OF_THE_TIDES_TALENT);
    },
  },
  //downpour
  {
    linkRelation: DOWNPOUR,
    reverseLinkRelation: DOWNPOUR,
    linkingEventId: [talents.DOWNPOUR_TALENT.id],
    linkingEventType: EventType.Heal,
    referencedEventId: [talents.DOWNPOUR_TALENT.id],
    referencedEventType: EventType.Cast,
    backwardBufferMs: CAST_BUFFER_MS,
    forwardBufferMs: CAST_BUFFER_MS,
    anyTarget: true,
    isActive(c){
      return c.hasTalent(talents.DOWNPOUR_TALENT);
    },
    additionalCondition(linkingEvent, referencedEvent) {
      return (linkingEvent as HealEvent).sourceID === (referencedEvent as CastEvent).sourceID;
    },
  },
];

class CastLinkNormalizer extends EventLinkNormalizer {
  constructor(options: Options) {
    super(options, EVENT_LINKS);
  }
}

export function isFromHardcast(event: AbilityEvent<any>): boolean {
  return HasRelatedEvent(event, HARDCAST);
}

export function isRiptideFromPrimordialWave(
  event: ApplyBuffEvent | RefreshBuffEvent | HealEvent,
): boolean {
  return HasRelatedEvent(event, RIPTIDE_PWAVE);
}

export function isHealingWaveFromPrimordialWave(event: HealEvent): boolean {
  return HasRelatedEvent(event, HEALING_WAVE_PWAVE);
}

export function wasPrimordialWaveConsumed(event: RemoveBuffEvent): boolean {
  return HasRelatedEvent(event, PWAVE_REMOVAL);
}

export function isFromPrimalTideCore(event: ApplyBuffEvent | HealEvent): boolean {
  return !HasRelatedEvent(event, HARDCAST) && !HasRelatedEvent(event, RIPTIDE_PWAVE);
}

export function getRiptideCastEvent(event: ApplyBuffEvent | RefreshBuffEvent): CastEvent | null {
  if (isFromHardcast(event)) {
    return GetRelatedEvents(event, HARDCAST)[0] as CastEvent;
  } else if (isRiptideFromPrimordialWave(event)) {
    return GetRelatedEvents(event, RIPTIDE_PWAVE)[0] as CastEvent;
  }
  return null;
}

export function getHealingRainEvents(event: CastEvent) {
  return GetRelatedEvents(event, HEALING_RAIN) as HealEvent[];
}

export function getHealingRainHealEventsForTick(event: HealEvent) {
  return [event].concat(GetRelatedEvents(event, HEALING_RAIN_GROUPING) as HealEvent[]);
}

export function getOverflowingShoresEvents(event: CastEvent) {
  return GetRelatedEvents(event, OVERFLOWING_SHORES) as HealEvent[];
}

export function getDownPourEvents(event: CastEvent) {
  return GetRelatedEvents(event, DOWNPOUR) as HealEvent[];
}

export function wasRiptideConsumed(event: HealEvent): boolean {
  return HasRelatedEvent(event, FLOW_OF_THE_TIDES);
}

export function getChainHeals(event: CastEvent): HealEvent[] {
  return GetRelatedEvents(event, CHAIN_HEAL) as HealEvent[];
}

export function getChainHealGrouping(event: HealEvent) {
  return [event].concat(GetRelatedEvents(event, CHAIN_HEAL_GROUPING) as HealEvent[]);
}
export default CastLinkNormalizer;
