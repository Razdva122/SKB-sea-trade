

/* Result log: 
v1: 6 тестов - 116689
v2: Попробую не брать предметы, которые стоят в сумме меньше 10: 117867
v3: Попробую не брать предметы, которые стоят в сумме меньше 25: 117845
v4: Попробую не брать предметы, которые стоят в сумме меньше 50: 118389 +++
v5: Попробую не брать предметы, которые стоят в сумме меньше 100: 118389
*/

let ship;

const minAmountOfItemsSum = 50;

export function startGame(levelMap, gameState) {
    const home = gameState.ports.find((port) => port.isHome);
    ship = new Ship([gameState.ship.y, gameState.ship.x], [home.y, home.x], 
        gameState.ports.filter((port) => !port.isHome), gameState.prices,
        gameState.goodsInPort, levelMap);
    //console.log(ship);
}

export function getNextCommand(gameState) {
    //console.log(JSON.stringify(gameState.goodsInPort,null,2));
    ship.homeGoods = gameState.goodsInPort;
    ship.currentPos = [gameState.ship.y, gameState.ship.x];
    if (gameState.pirates.length) {
        ship.pirates = true;
        ship.map = JSON.parse(JSON.stringify(ship.initMap));
        gameState.pirates.forEach((pirate) => {
            // X - опасность
            ship.map[pirate.y][pirate.x] = 'X';
        })
        // Корабль(Ship)
        ship.map[gameState.ship.y][gameState.ship.x] = 'S';
    }
    return ship.doAction();
}


class Ship {
    constructor(initPos, homePos, ports, prices, homeGoods, levelMap) {
        this.currentPos = initPos;
        this.homePos = homePos;
        this.homeGoods = homeGoods;
        this.ports = ports;
        this.prices = prices;
        this.generateMap(levelMap);
        this.initConfig();
        this.initActions();
    }

    initConfig() {
        // Обьем трюма
        this.maxCap = 368;
        // Максимальное количество ходов
        this.maxTurn = 180;
        // Номер текущей экспедиции
        this.currentExpedition = 0;
        // Номер текущего хода
        this.turn = 0;
        // Массив Действий
        this.actions = [];
        // Команды
        this.commands = {
            'N': () => 'N',
            'S': () => 'S',
            'W': () => 'W',
            'E': () => 'E',
            'LOAD': (productName, amount) => `LOAD ${productName} ${amount}`,
            'UNLOAD': (productName, amount) => `UNLOAD ${productName} ${amount}`,
            'SELL': (productName, amount) => `SELL ${productName} ${amount}`,
            'WAIT': () => 'WAIT'
        };
        // Возможные движения
        this.mapMoves = {
            '0,1': 'E',
            '0,-1': 'W',
            '1,0': 'S',
            '-1,0': 'N',
        },
        this.reversedMapMoves = {
            'E': [0, 1],
            'W': [0, -1],
            'S': [1, 0],
            'N': [-1, 0],
        }
        this.reversedDirection = {
            'W': 'E',
            'E': 'W',
            'N': 'S',
            'S': 'N',
        }
        this.arrayOfMoves = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    }

    initActions() {
        // Карта путей от домашнего порта
        this.generatePathsMap();
        // Координаты для портов и путь из порта в домашний порт
        this.createExtraInfoForPorts();
        // Создать все экспедиции
        this.constructAllExpeditions();
        // Дополнить информацию по экспедициям
        this.generateExtraInfoForExpeditions();
        // Отсортировать экспедиции
        this.sortExpeditions();
    }

    constructAllExpeditions() {
        this.expeditions = [];
        this.prices.forEach((portPrices) => {
            const goodsAvailable = JSON.parse(JSON.stringify(this.homeGoods));
            for (const goodNumber in goodsAvailable) {
                const goodName = goodsAvailable[goodNumber].name;
                if (!portPrices[goodName]) {
                    delete goodsAvailable[goodNumber];
                    continue;
                }
                goodsAvailable[goodNumber].price = portPrices[goodName];
                goodsAvailable[goodNumber].profit = portPrices[goodName] / goodsAvailable[goodNumber].volume;
            }
            const itemsForBuy = Object.keys(goodsAvailable);
            itemsForBuy.sort((a, b) => {
                return b.profit - a.profit
            })
            while (itemsForBuy.length) {
                const expedition = {
                    portId: portPrices.portId,
                    items: [],
                    total: 0,
                    price: 0,
                };
                for (let i = 0; i < itemsForBuy.length; i += 1) {
                    if (expedition.total === this.maxCap) {
                        break;
                    }
                    const itemNumber = itemsForBuy[i];
                    const leftSpace = this.maxCap - expedition.total;
                    if (goodsAvailable[itemNumber].volume > this.maxCap) {
                        itemsForBuy.splice(i, 1);
                        i -= 1;
                        continue;
                    }
                    let amountOfItems = Math.floor(leftSpace / goodsAvailable[itemNumber].volume);
                    if (amountOfItems === 0) {
                        continue;
                    }
                    if (amountOfItems >= goodsAvailable[itemNumber].amount) {
                        amountOfItems = goodsAvailable[itemNumber].amount;
                        itemsForBuy.splice(i, 1);
                        i -= 1;
                    }
                    if (amountOfItems * goodsAvailable[itemNumber].price < minAmountOfItemsSum) {
                        continue;
                    }
                    expedition.items.push({ name: goodsAvailable[itemNumber].name, amount: amountOfItems });
                    expedition.total += amountOfItems * goodsAvailable[itemNumber].volume;
                    expedition.price += amountOfItems * goodsAvailable[itemNumber].price;
                    goodsAvailable[itemNumber].amount -= amountOfItems;
                }
                this.expeditions.push(expedition);
            }
        })
    }

    // Генерируем для экспедиции координаты в нужном формате и дистанцию
    generateExtraInfoForExpeditions() {
        this.expeditions.forEach((exp) => {
            const port = this.ports.find((port) => port.portId === exp.portId);
            exp.destination = port.coords;
            exp.road = port.road;
            exp.backRoad = port.backRoad;
            exp.distance = exp.road.length * 2 + exp.items.length;
            exp.profit = exp.price / exp.distance;
        })
    }

    // Создаем карту
    generateMap(levelMap) {
        this.map = levelMap.split('\n').map((row) => row.split(''));
        this.initMap = this.map;
    }

    // Строим карту маршрутов
    generatePathsMap() {
        this.pathMap = new Array(this.map.length).fill(null).map(() => new Array(this.map[0].length).fill(null));
        this.pathMap[this.homePos[0]][this.homePos[1]] = {
            prev: null
        };
        (function generatePaths(pathMap, stack) {
            if (stack.length === 0) {
                return
            }
            const currentCoord = stack.splice(0, 1)[0];
            this.arrayOfMoves.forEach((move) => {
                const newCoord = [currentCoord[0] + move[0], currentCoord[1] + move[1]];
                if (!(this.isValidPos(newCoord))) {
                    // Вышли за рамки карты
                    return;
                }
                if (this.map[newCoord[0]][newCoord[1]] === '#' || pathMap[newCoord[0]][newCoord[1]]) {
                    // Скала или клетка уже просканированна
                    return;
                }
                pathMap[newCoord[0]][newCoord[1]] = {
                    prev: currentCoord
                }
                stack.push(newCoord);
            })
            generatePaths.apply(this, [pathMap, stack]);
        }).apply(this, [this.pathMap, [this.homePos]]);
    }

    // Сортируем экспедиции по профиту
    sortExpeditions() {
        this.expeditions.sort((exp1, exp2) => {
            return exp2.profit - exp1.profit;
        })
    }

    // Создаем координаты для портов в удобном формате и делаем маршрут до порта и обратно
    createExtraInfoForPorts() {
        this.ports.forEach((port) => {
            port.coords = [port.y, port.x];
        });
        this.ports.forEach((port) => {
            port.backRoad = this.createPath(port.coords);
            // Переворачиваем путь
            port.road = [...port.backRoad].reverse().map((direction) => this.reversedDirection[direction]);
        })
    }

    // Сделать ход
    doAction() {
        // Если у нас есть действие сделать его
        if (this.actions.length) {
            this.turn += 1;
            let actionToDo = this.actions.splice(0, 1)[0];
            if (['W','E','N','S'].includes(actionToDo) && this.pirates) {
                const nextPosition = [this.currentPos[0] + this.reversedMapMoves[actionToDo][0],
                    this.currentPos[1] + this.reversedMapMoves[actionToDo][1]];
                if (!this.positionSafeFromPirates(nextPosition)) {
                    if (!this.positionSafeFromPirates(this.currentPos)) {
                        let possibleMoves = this.arrayOfMoves.map(i => [i[0] + this.currentPos[0], i[1] + this.currentPos[1]])
                            .filter(this.isValidPos.bind(this))
                            .filter(this.positionSafeFromPirates.bind(this))
                            .filter(this.isPositionAvailableForMove.bind(this))
                        this.actions.splice(0, 0, actionToDo);
                        // Тупо или гениально вот в чем вопрос
                        const newPos = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
                        const commandMove = this.mapMoves[[newPos[0] - this.currentPos[0], newPos[1] - this.currentPos[1]].join()]
                        actionToDo = commandMove;
                        this.actions.splice(0, 0, this.reversedDirection[commandMove]);
                    } else {
                        this.actions.splice(0, 0, actionToDo);
                        actionToDo = 'WAIT';
                    }  
                }
            }
            return actionToDo;
        } 
        // Иначе создать новое действие
        if (this.isSamePos(this.currentPos, this.homePos)) {
            this.makeExpedition();
        } else {
            this.goHome(this.currentPos);
        }
        return this.doAction();
    }

    // Создать маршрут до домашнего порта
    createPath(fromCooridantes) {
        let currentPosition = this.pathMap[fromCooridantes[0]][fromCooridantes[1]];
        let positionCoordinates = fromCooridantes;
        const road = [];
        while (currentPosition.prev) {
            const move = [currentPosition.prev[0] - positionCoordinates[0], currentPosition.prev[1] - positionCoordinates[1]];
            road.push(this.mapMoves[move.join()]);
            positionCoordinates = [currentPosition.prev[0], currentPosition.prev[1]];
            currentPosition = this.pathMap[currentPosition.prev[0]][currentPosition.prev[1]];
        }
        return road;
    }

    // Ехать домой
    goHome(fromCooridantes) {
        this.move(this.createPath(fromCooridantes))
    }

    // Двигаться по инструкциям
    move(arrayOfMoveInstruction) {
        this.actions.push(...arrayOfMoveInstruction);
    }

    // Создать задачи на экспедицию
    makeExpedition() {
        const bestExpedition = this.findBestExpedition();
        // Если экспедиции закончились
        if (!bestExpedition) {
            this.actions.push(this.commands['WAIT']());
            return;
        }
        this.loadItems(bestExpedition.items);
        this.move(bestExpedition.road);
        this.sellItems(bestExpedition.items);
        this.move(bestExpedition.backRoad);
    }

    // Ищем лучшую валидную экспедицию
    findBestExpedition() {
        while (!this.isValidExpedition()) {
            this.currentExpedition += 1;
            if (this.currentExpedition >= this.expeditions.length) {
                return null;
            }
        }
        const bestExpedition = {
            items: this.expeditions[this.currentExpedition].items,
            road: this.expeditions[this.currentExpedition].road,
            backRoad: this.expeditions[this.currentExpedition].backRoad,
        }
        this.currentExpedition += 1;
        return bestExpedition;
    }

    // Проверяем достаточно ли товаров и времени для экспедиции
    isValidExpedition() {
        const curExp = this.expeditions[this.currentExpedition];
        if (this.currentExpedition >= this.expeditions.length) {
            return null;
        }
        const isValidExp = curExp.items.every((item) => {
            const findedGood = this.homeGoods.find((good) => item.name === good.name);
            return findedGood && findedGood.amount >= item.amount;
        }) && ((curExp.distance) < this.maxTurn - this.turn);
        return isValidExp;
    }

    // Загружаем товары
    loadItems(items) {
        items.forEach((item) => {
            this.actions.push(this.commands['LOAD'](item.name, item.amount));
        })
    }

    // Продаем товары
    sellItems(items) {
        items.forEach((item) => {
            this.actions.push(this.commands['SELL'](item.name, item.amount));
        })
    }

    // Находится ли позиция в пределах карты
    isValidPos(pos) {
        return pos[0] >= 0 && pos[0] < this.map.length && pos[1] >= 0 && pos[1] < this.map[0].length;
    }

    // Проверяем безопасна ли позиция
    positionSafeFromPirates(position) {
        const possibleMoves = [...this.arrayOfMoves, [0, 0]];
        return possibleMoves.every((move) => {
            const newPos = [position[0] + move[0], position[1] + move[1]];
            if (!this.isValidPos(newPos)) {
                return true;
            }
            return this.map[newPos[0]][newPos[1]] !== 'X';
        })
    }

    // Можно ли двигать на эту клетку
    isPositionAvailableForMove(pos) {
        return this.map[pos[0]][pos[1]] !== '#';
    }

    // Сравниваем две позиции
    isSamePos(posA, posB) {
        return posA[0] === posB[0] && posA[1] === posB[1];
    }
}