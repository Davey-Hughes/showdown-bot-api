import socket
import struct
import json
import time

class PokeSockClient:
    def __init__(self, sock=None):
        if sock is None:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        else:
            self.sock = sock

    def connect(self, host, port):
        self.sock.connect((host, port))

    def send(self, msg_obj):
        msg = bytes(json.dumps(msg_obj), 'utf-8')
        length = len(msg)
        self.sock.sendall(struct.pack('!I', length) + msg)

    def recv(self):
        lengthbuf = self.recvall(4)
        length, = struct.unpack('!I', lengthbuf)
        bmsg = self.recvall(length)
        return json.loads(bmsg.decode('utf-8'))

    def recvall(self, count):
        buf = b''
        while count:
            newbuf = self.sock.recv(count)
            if not newbuf:
                return None
            buf += newbuf
            count -= len(newbuf)

        return buf;

    def close(self):
        self.sock.close()

class ShowdownConnection:
    def __init__(self):
        self.pokeSock = PokeSockClient()

    def login(self, host, port, username, password=''):
        self.pokeSock.connect(host, port)

        msg = json.dumps({
            'command': 'login',
            'username': username,
            'password': password
        })

        self.pokeSock.send(msg)
        result = self.pokeSock.recv()
        return result == 'success'

    def logout(self, room=''):
        if room != '':
            msg = json.dumps({
                'command': 'logout',
                'room': room
            })
        else:
            msg = json.dumps({
                'command': 'logout'
            })

        self.pokeSock.send(msg)
        result = self.pokeSock.recv()

    def send_challenge(self, user, gamefmt, room=''):
        if room == '':
            msg = json.dumps({
                'command': 'send_challenge',
                'user': user,
                'format': gamefmt,
                'room': room
            })
        else:
            msg = json.dumps({
                'command': 'send_challenge',
                'user': user,
                'format': gamefmt
            })

        self.pokeSock.send(msg)
        result = self.pokeSock.recv()
        return result == 'success'

    def send_default(self, msg, room=''):
        if room != '':
            msg = json.dumps({
                'command': 'send_default',
                'showdown_cmd': msg,
                'room': room
            })
        else:
            msg = json.dumps({
                'command': 'send_default',
                'showdown_cmd': msg
            })

        self.pokeSock.send(msg)
        result = self.pokeSock.recv()

    def close(self):
        self.pokeSock.close();
