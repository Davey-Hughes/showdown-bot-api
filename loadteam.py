import subprocess
import json
from pprint import pprint

def parse_stats(line, vs_str):
    vs = {
        'hp': 0,
        'atk': 0,
        'def': 0,
        'spa': 0,
        'spd': 0,
        'spe': 0
    }
    line = line.replace(vs_str + ': ', '').split('/')
    for stat in line:
        stat = stat.lower()

        for key in vs.keys():
            if key in stat:
                vs[key] = int(stat.replace(key, '').lstrip(' ').rstrip(' '))

    return vs

def parse_team(filepath):
    team = []

    with open(filepath, 'r') as f:
        pokes = f.read().split('\n\n')
        for poke in pokes:
            poke = poke.split('\n')
            cur_poke = {}
            cur_poke['moves'] = []

            for i, line in enumerate(poke):
                line = line.lstrip(' ')

                if i == 0:
                    if '@' in line:
                        at_index = line.find('@')
                        cur_poke['item'] = line[at_index + 2:]
                        line = line[:at_index]

                    if '(F)' in line:
                        cur_poke['gender'] = 'F'
                        line = line.replace('(F)', '').lstrip().rstrip()
                    elif '(M)' in line:
                        cur_poke['gender'] = 'M'
                        line = line.replace('(M)', '').lstrip().rstrip()

                    line = line.rstrip().split(' ')
                    if len(line) == 1:
                        cur_poke['species'] = line[0]
                    else:
                        cur_poke['name'] = line[0]
                        cur_poke['species'] = line[1].replace('(', '').replace(')', '')

                elif 'Ability:' in line:
                    cur_poke['ability'] = line.replace('Ability:', '').lstrip(' ')


                elif 'Level: ' in line:
                    cur_poke['level'] = int(line.replace('Level: ', '').lstrip(' '))

                elif 'Shiny: ' in line:
                    shiny = line.replace('Shiny: ', '').lstrip(' ')
                    if shiny.lower() == 'yes':
                        cur_poke['shiny'] = True

                elif 'Happiness: ' in line:
                    cur_poke['happiness'] = int(line.replace('Happiness: ', '').lstrip(' '))

                elif 'EVs: ' in line:
                    cur_poke['evs'] = parse_stats(line, 'EVs')

                elif 'IVs: ' in line:
                    cur_poke['ivs'] = parse_stats(line, 'IVs')

                elif ' Nature' in line:
                    cur_poke['nature'] = line.replace(' Nature', '').lstrip(' ')

                elif len(line) and line[0] == '-':
                    line = line[1:].lstrip(' ')
                    cur_poke['moves'].append(line)

            team.append(cur_poke)

    return team

def packTeam(team):
    json_team = json.dumps(team)
    p = subprocess.run(['node', 'packteam.js', json_team], stdout=subprocess.PIPE)
    return p.stdout.decode('utf-8').replace('\n', '')
