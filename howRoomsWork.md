# How rooms work

This document describes how TransChat rooms are created, found and joined, and what happens when people leave. The examples use a room with the code `green-frog-12`.

## Where a room lives

A room is not stored anywhere. TransChat has no server of its own, and nothing records that a room exists. The only shared component is a free **introduction service** (the PeerJS signalling server at `0.peerjs.com`, run by the PeerJS project).

The introduction service works like a telephone switchboard:

- **Holding a name.** A browser can ask to be reachable under a name, provided no other browser is using that name at the time. The browser keeps the name only while it stays connected to the service.
- **Calling a name.** A browser can ask to be put through to a name. The service passes the connection details (network addresses and encryption keys) between the two browsers and then steps aside.
- **What the service does not do.** It never sees chat messages and stores nothing. It knows only which names are currently in use and the network addresses needed to connect them.

## Starting a room

When person A chooses **Start a new room**:

1. A's browser connects to the service and receives a random **personal name**, for example `3f9c1a…`. This works like a private phone number.
2. The browser picks a random room code, such as `green-frog-12`, and asks for a second name, the room's **public name**: `transchat-v2-green-frog-12`. If that name is already in use, another code is picked automatically.
3. A's browser now holds the room's public name. That is all it means for the room to exist. The browser holding the public name is called the **doorkeeper**.

## Who creates the names

- **Room codes are created by TransChat**, in the browser. When **Start a new room** is chosen, the page picks a random colour, a random animal and a number from 10 to 99 (for example `green-frog-12`), adds the prefix `transchat-v2-`, and asks the service to reserve that name. The service only accepts or refuses the request; if the name is taken, TransChat picks another code.
- **Personal names are created by the service.** Each browser is given a random one when it connects. People never see these names.
- **When joining**, the person types the room code, and TransChat adds the same `transchat-v2-` prefix before calling it.

## Why one browser holds the room name

Everyone in a room knows the room code, but knowing a name is not the same as holding it. The introduction service lets only **one browser at a time** hold a given name, in the same way that a phone number rings one phone. Everyone may know a shop's number, but when someone calls it, one particular phone rings and someone has to answer it.

Joining a room means calling the room's public name. The service puts the call through to whichever browser currently holds that name. If no browser holds it, the call fails and the newcomer is told the room was not found.

The doorkeeper is therefore simply the browser that answers when someone calls the room's name. It is needed because:

- **The service has no concept of a room.** It only connects one browser to another by name. It cannot keep a list of members or make one name ring several browsers.
- **A newcomer needs someone to ask who is there.** Answering the call to the room name is the only way the newcomer can find out whom to connect to.

A service that kept each room's member list would remove the need for a doorkeeper, but that would require TransChat to run a server of its own, which the design avoids. Once a newcomer has connected to everyone, the doorkeeper has no special part in the conversation; the role matters only when the next person joins.

## Joining a room

When person B enters the code `green frog 12` and chooses **Join room**:

1. B's browser receives its own random personal name, then asks the service to put it through to `transchat-v2-green-frog-12`.
2. The service connects B to the doorkeeper, A. In effect, B is asking "who is in this room?"
3. The doorkeeper replies with the personal names of everyone in the room. At this point, that is only A.
4. B ends that call and calls each person on the list by their personal name, again through the service. Once connected, messages go directly between the two browsers, encrypted, without passing through the service.
5. When person C joins, the same steps happen, but the list contains both A and B, so C connects to each of them.

Every browser in the room is connected directly to every other browser. Only the doorkeeper holds the room's public name. Everyone else can be reached only by their random personal name, which is shared only with people inside the room.

## Leaving a room

### When the doorkeeper leaves

When A leaves, A's browser gives up the name `transchat-v2-green-frog-12`. B and C notice that A has gone, and both ask the service for the public name. The first to ask receives it and becomes the new doorkeeper. B and C were already connected to each other, so their conversation continues uninterrupted, and new people can still join using the same code.

### How the service knows the holder is still there

The service keeps a table of which browser holds each name, and it knows that a holder is still active in two ways:

1. **An open connection.** A browser holding a name keeps a continuous connection (a WebSocket) open to the service, and the name belongs to that connection. When the person presses **Leave** or closes the tab, the connection closes and the service frees the name immediately. A newcomer can then join within a few seconds, once one of the remaining browsers has taken over.
2. **Heartbeats.** If a computer freezes, goes to sleep or loses its network, the connection can stay technically open with nothing coming through it. To detect this, the PeerJS library in each browser sends a short "heartbeat" message to the service every 5 seconds. If the service hears nothing from a holder for a while, it assumes the browser has gone and frees the name. The open-source PeerJS server waits 90 seconds by default, and tests against the public service are consistent with that.

### Two separate checks

TransChat has its own check inside the room, separate from the service's. Every browser in the room sends a "still here" signal to every other browser every 5 seconds. The two checks do different jobs:

| Check | Between | Gives up after | Decides |
|---|---|---|---|
| TransChat's "still here" signal | Browsers in the room | 20 seconds of silence | When the others hear "A left" |
| PeerJS heartbeat | Each browser and the service | 90 seconds of silence | When the room name is free to be taken over |

If the doorkeeper's computer freezes, the people in the room are therefore told after about 20 seconds that the doorkeeper has left, and they can keep chatting. Newcomers, however, cannot join until the service frees the room name, about a minute and a half after the freeze.

### When everyone leaves

When the last person closes the page or presses **Leave**, their browser gives up the public name and the service forgets it. Nothing else needs to be cleaned up; the room simply stops existing:

- Anyone entering `green frog 12` afterwards is told that no such room was found.
- The messages are gone. They only ever existed in each person's open page and were never saved anywhere.
- Someone starting a new room later might, by chance, be given the same code. That room is new and has no connection to the old one.

## Other points

- **Access.** Anyone who knows the code can join, up to a limit of 8 people. The code works like a password that is easy to read aloud. Everyone in the room hears each person who joins announced.
- **Number of codes.** There are about 17,000 possible codes. A code only needs to be unique among the rooms open at that moment, so this is more than enough.
- **Dependence on the introduction service.** If the service is unavailable, nobody can start or join a room. Conversations already under way continue, because their connections do not pass through the service.
- **Helper servers.** As well as the introduction service, the PeerJS library uses two kinds of helper server:
  - An **address checker** (Google's STUN server), which tells each browser its public internet address.
  - **Relay servers** (TURN servers run by PeerJS). When a network blocks direct connections, messages travel through one of these relays instead. They remain encrypted between the two browsers, so the relay cannot read them. As a result, most pairs of people who cannot connect directly still reach each other through a relay.
