import socket
import struct
import json
import time
from multiprocessing import Process, Lock

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

class PokeBattle:
    def __init__(self, connection, room, challenger):
        self.connection = connection
        self.room = room
        self.challenger = challenger

    def wrapper(self, func):
        func(self)

        self.connection.lock.acquire()
        self.connection.battles.remove(self)
        self.connection.lock.release()
        exit(0)


class ShowdownConnection:
    def __init__(self):
        self.pokeSock = PokeSockClient()
        self.lock = Lock()
        self.battles = []
        self.battle_processes = []

    def login(self, host, port, username, password=''):
        self.username = username
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

        # try 10 times (and 10 seconds)
        for i in range(10):
            res_challenges, res_errors = self.get_challenges()
            if res_challenges != {} and res_challenges['challengeTo']:
                if res_challenges['challengeTo']['to'] == user:
                    return True

            for error in res_errors:
                if 'not found' in error or \
                   'already challenging someone' in error or \
                   'cancelled' in error:
                    return False

            time.sleep(1)

        return False

    def get_challenges(self):
        msg = json.dumps({
            'command': 'get_challenges'
        })
        self.pokeSock.send(msg)
        res_challenges = self.pokeSock.recv()
        res_errors = self.pokeSock.recv()
        return res_challenges, res_errors

    def get_battles(self):
        msg = json.dumps({
            'command': 'get_battles'
        })
        self.pokeSock.send(msg)
        result = self.pokeSock.recv()
        return result


    # accept can be either a list of dicts, which specifies each user to accept
    # a battle from and the function to run for that battle, or it can be a
    # function to fun when accepting any battle

    # if a timeout is passed in, this function will try to accept a battle for
    # the amount of seconds passed in, default 60 seconds
    def wait_for_battle(self, accept, timeout=60):
        if isinstance(accept, list):
            return None
        elif callable(accept):
            for i in range(timeout):
                battles = self.get_battles()
                if len(battles):
                    room = battles[0]['room']
                    challenger = ''
                    for user in battles[0]['data'].split(' vs. '):
                        if self.username not in user:
                            challenger += user

                    battle = PokeBattle(self, room, challenger)
                    self.lock.acquire()
                    self.battles.append(battle)
                    self.lock.release()

                    p = Process(target=battle.wrapper, args=(accept,))
                    p.start()
                    self.battle_processes.append({
                        'room': room,
                        'process': p
                    })

                    return room

                time.sleep(1)

        else:
            return None

    # wait for all battles to complete if no room specified, otherwise wait for
    # specific battle to complete
    def wait_for_battles_complete(self, room=None):
        if room:
            for item in self.battle_processes:
                if item['room'] == room:
                    item['process'].join()
                    self.battle_processes.remove(item)
                    return True

            # didn't find a battle with that room name
            return False
        else:
            for item in self.battle_processes:
                item['process'].join()
                self.battle_processes.remove(item)

            return True

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
