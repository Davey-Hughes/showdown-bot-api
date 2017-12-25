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
    def __init__(self, parent_conn, room, challenger, host, port, open_wndw):
        self.parent_conn = parent_conn
        self.room = room
        self.challenger = challenger
        self.turn = 0
        self.battle_conn = PokeSockClient()
        self.battle_conn.connect(host, port)

        msg = json.dumps({
            'command': 'battle_start',
            'username': self.parent_conn.username,
            'room': room,
            'open_wndw': open_wndw
        })

        self.battle_conn.send(msg)
        result = self.battle_conn.recv()

    # TODO add safety so this can only be called properly
    def _wrapper(self, func):
        self.wait_turn_one()
        func(self)

        self.parent_conn.battle_lock.acquire()
        self.parent_conn.battles.remove(self)
        self.parent_conn.battle_lock.release()
        exit(0)

    def wait_turn_one(self):
        self.wait_next_turn()

    # tries to get data for up to 10 seconds. returns data if found, else
    # returns None
    def _get_wrapper(self, battle_command):
        for i in range(10):
            result = self.send_battle_command(battle_command, self.room)
            if result != {}:
                return result

            time.sleep(1)

        return None

    def get_myteam(self):
        return self._get_wrapper('get_myteam')

    def get_actions(self):
        return self._get_wrapper('get_actions')

    def get_chat(self):
        return self._get_wrapper('get_chat')

    def send_battle_command(self, battle_command, command_msg=None):
        msg_obj = {
            'command': 'battle_action',
            'battle_command': battle_command,
            'room': self.room
        }

        if (command_msg):
            msg_obj['command_msg'] = command_msg

        msg = json.dumps(msg_obj)

        self.battle_conn.send(msg)
        result = self.battle_conn.recv()

        return result

    def do_move(self, move=1):
        command_msg = ''

        if isinstance(move, int):
            command_msg = '/choose move ' + str(move)
        elif isinstance(move, string):
            return False
        else:
            return False

        self.send_battle_command('do_move', command_msg)
        return True

    def do_switch(self, switch=2):
        command_msg = ''

        if isinstance(switch, int):
            command_msg = '/choose switch ' + str(switch)
        elif isinstance(switch, string):
            return False
        else:
            return False

        self.send_battle_command('do_switch', command_msg)
        return True

    def sync_turns(self):
        actions = self.get_actions()
        self.turn = len(actions) - 1

    def wait_next_turn(self):
        msg = json.dumps({
            'command': 'battle_action',
            'battle_command': 'wait_next_turn',
            'turn': self.turn
        })

        self.battle_conn.send(msg)
        result = self.battle_conn.recv()
        if isinstance(result, str):
            return False

        self.turn = result
        return result

    def do_command_default(self, command_msg):
        self.send_battle_command('do_command_default', command_msg)

class ShowdownConnection:
    def __init__(self):
        self.pokeSock = PokeSockClient()
        self.battle_lock = Lock()
        self.battles = []
        self.battle_processes = []

    def login(self, host, port, username, password=''):
        self.host = host
        self.port = port
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
    def wait_for_battle(self, accept, open_wndw=False, timeout=60):
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

                    battle = PokeBattle(self, room, challenger, \
                                        self.host, self.port, open_wndw)
                    self.battle_lock.acquire()
                    self.battles.append(battle)
                    self.battle_lock.release()

                    p = Process(target=battle._wrapper, args=(accept,))
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
