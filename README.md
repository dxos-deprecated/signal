# DxOS Signal Server

## Usage

```
$ PORT=3000 node index.js
```


# Related Technologies

## Offers and Answers
Many peer-to-peer networking protocols use an "offer/answer" scheme for negotiating communication between parties.  For WebRTC, Session Description Protocol (SDP) is used, a technology borrowed from SIP.  The offer/answer phase does not stream any content between the peers, it is exclusively used for conveying information about the peers' networking and capabilities so that direct communication can be successfully established.

## Signals
The offers and answers have to be transmitted between the parties.  Theoretically they could be conveyed in various forms (email, IM, carrier pigeon), but practically a mutually agreed "signaling server" is used most often.  The signaling server is not used to transmit application data, it only passes the offers and answers between the prospective peers.  For the messages to be passed successfully, the parties must be configured to use the same signaling server.

## STUN
Session Traversal Utilities for NAT (STUN) is a protocol for helping clients on separate private networks communicate directly.  A client will send a series of requests to a STUN server in an operation called "binding", and the server will report back to the client the IP address and port of each request as observed by the STUN server--a sort of grander version of the question, 'What is my IP?'  These are collected by the client and added to the offer--or answer--as "candidates" for communication.  There is no need for the parties to use the same STUN server.  A STUN server requires few resources to run, and there are many freely available, public STUN servers.

## TURN
It is quite possible that none of the candidates discovered by STUN establish successful communication between the parties.  In that case, a Traversal Using Relay around NAT (TURN) server can be used to relay the traffic.  The parties request a "media relay address", which is an IP/port pair on the TURN server itself.  This is added to the list of candidates in the offer or answer, and is signaled to the other party in the usual way.  Communicating via the media relay address on the TURN server proxies application data between the parties.  Proxying all the network traffic is very resource intensive; as result there are few, if any, freely available TURN servers.  As with STUN, it is not necessary that the parties be configured to use the same TURN server.

## ICE
Interactive Connectivity Establishment (ICE) is the protocol standardizing the use of STUN and TURN for establishing connection between peers.  It is often used as a general term describing this suite of protocols for P2P communication.

https://en.wikipedia.org/wiki/Interactive_Connectivity_Establishment
