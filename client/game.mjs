let ship;

export function startGame(levelMap, gameState) {
    const home = gameState.ports.find((port) => port.isHome);

    ship = new Ship([gameState.ship.y, gameState.ship.x], [home.y, home.x], 
        gameState.ports.filter((port) => !port.isHome), gameState.prices,
        gameState.goodsInPort, levelMap);
}

export function getNextCommand(gameState) {
    ship.homeGoods = gameState.goodsInPort;
    ship.currentPos = [gameState.ship.y, gameState.ship.x];
    ship.score = gameState.score;

    if (ship.logger && ship.turn === 178) {
        console.log(ship.score);
    }

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
        this.maxTurn = 179;
        // Номер текущего хода
        this.turn = 0;
        // Массив Действий
        this.actions = [];
        // Логгирование для статиситики
        this.logger = false;
        // Экспедиции
        this.expeditions = [];

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
        // Инвертированная карта
        this.reversedMapMoves = {
            'E': [0, 1],
            'W': [0, -1],
            'S': [1, 0],
            'N': [-1, 0],
        }
        // Движение в противоположную сторону
        this.reversedDirection = {
            'W': 'E',
            'E': 'W',
            'N': 'S',
            'S': 'N',
        }
        // Все возможные направления движения
        this.arrayOfMoves = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    }

    initActions() {
        // Карта путей от домашнего порта
        this.generatePathsMap();
        // Координаты для портов и путь из порта в домашний порт
        this.createExtraInfoForPorts();
        // Ближайшая дорога до порта
        this.minRoadToPort = this.ports.reduce((acc, port) => {
            return Math.min(acc, port.road.length)
        }, 1000);
        // 5 дорог + 3 раза по одному предмету купить и продать
        this.stopGreedy = this.minRoadToPort * 5 + 6;
        // Отсортировать экспедиции
        this.sortExpeditions();
    }

    // Создание двух лучших экспедиций
    createTwoBestExpeditions() {
        // Варианты экспедиций
        const variants = [];
        this.ports.forEach((firstPort) => {
            this.ports.forEach((secondPort) => {
                const variant = {
                    items: {},
                    prices: [],
                    total: 0,
                    id: variants.length,
                };

                this.homeGoods.forEach((good) => {
                    variant.items[good.name] = {
                        amount: good.amount,
                        volume: good.volume,
                    }
                });

                variant.ports = [JSON.parse(JSON.stringify(firstPort)), JSON.parse(JSON.stringify(secondPort))];
                variant.ports.forEach((port) => {
                    port.itemsForTravel = [];
                    port.leftSpaces = ship.maxCap;
                });
                variant.ports.sort((a, b) => a.road.length - b.road.length);

                // Пропускаем варианты дубликаты
                if (variants.some(variantForSearch => {
                    return variantForSearch.ports.every((port, index) => {
                        return port.portId === variant.ports[index].portId;
                    })
                })) {
                    return;
                }

                // 2 дороги + дорога во второе место + 2 пачки предметов
                Object.defineProperty(variant, 'stepsLeft', {
                    get: function() {
                        return ship.maxTurn - (this.ports[0].road.length * 2 + this.ports[1].road.length +
                            this.ports[0].itemsForTravel.length * 2 + this.ports[1].itemsForTravel.length * 2 +
                                ship.turn);
                    }
                });

                // Для каждой экспедиции добавляем список товаров которые можно купить в ней 
                variant.ports.forEach((port, index) => {
                    for (const nameOfGood in port.prices) {
                        if (variant.items[nameOfGood]) {
                            const itemData = {
                                portIndex: index,
                                name: nameOfGood,
                                price: port.prices[nameOfGood] || 0,
                            };
                            itemData.volume = variant.items[itemData.name].volume;
                            itemData.pricePerSpace = itemData.price / itemData.volume;
                            Object.defineProperties(itemData, {
                                'leftSpaces': {
                                    get: function() {
                                        return port.leftSpaces;
                                    }
                                },
                                'maxAmountOfItems': {
                                    get: function() {
                                        return Math.min(Math.floor(this.leftSpaces / this.volume), variant.items[nameOfGood].amount);
                                    }
                                },
                                'moneyProfit': {
                                    get: function() {
                                        return this.maxAmountOfItems * this.price
                                    }
                                }
                            })
                            variant.prices.push(itemData)
                        }
                    }
                });
                
                // Пока 2(Купить - продать предмет) или больше шагов добавляем предметы
                while (variant.stepsLeft > 1) {
                    // Убираем предметы которые уже нельзя купить
                    variant.prices = variant.prices.filter((singlePrice) => singlePrice.maxAmountOfItems > 0);
                    // Если предметы закончились выходим из цикла
                    if (variant.prices.length === 0) {
                        break;
                    }

                    let item;
                    if (variant.stepsLeft > 5) {
                        // Берем самые профитные предметы по соотношению на еденицу места
                        variant.prices.sort((a, b) => {
                            return b.pricePerSpace - a.pricePerSpace;
                        });
                        if (variant.prices[0].maxAmountOfItems) {
                            item = variant.prices[0];
                            variant.ports[item.portIndex].itemsForTravel.push({
                                name: item.name,
                                amount: item.maxAmountOfItems,
                            });
                        }
                    } else {
                        // Берем предметы, которые принесут максимальное количество денег
                        variant.prices.sort((a, b) => {
                            return b.moneyProfit - a.moneyProfit;
                        });
                        item = variant.prices[0];
                        variant.ports[item.portIndex].itemsForTravel.push({
                            name: item.name,
                            amount: item.maxAmountOfItems,
                        });
                    }
                    variant.total += item.moneyProfit;
                    variant.ports[item.portIndex].leftSpaces -= item.maxAmountOfItems * item.volume;
                    variant.items[item.name].amount -= item.maxAmountOfItems;
                }
                variants.push(variant);
            })
        });
        const bestVariant = variants.reduce((acc, curVal) => {
            if (curVal.total > acc.total) {
                acc = curVal;
            } else if (curVal.total === acc.total) {
                if (curVal.stepsLeft > acc.stepsLeft) { 
                    acc = curVal;
                }
            }
            return acc;
        }, variants[0]);

        this.loadItems(bestVariant.ports[0].itemsForTravel);
        this.move(bestVariant.ports[0].road);
        this.sellItems(bestVariant.ports[0].itemsForTravel);
        this.move(bestVariant.ports[0].backRoad);
        this.loadItems(bestVariant.ports[1].itemsForTravel);
        this.move(bestVariant.ports[1].road);
        this.sellItems(bestVariant.ports[1].itemsForTravel);

        for (let i = 0; i < 10; i += 1) {
            // Просто ждем если остались свободные ходы
            this.actions.push(this.commands['WAIT']());
        }
    }

    constructExpeditionsForEveryPort() {
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
                return goodsAvailable[b].profit - goodsAvailable[a].profit
            })
            const port = this.ports.find((port) => port.portId === portPrices.portId);
            const possibleExpeditions = [];

            for (let j = 0; j < itemsForBuy.length; j += 1) {
                // Вариант в котором мы меняем главный продукт для покупки
                let newItemsForBuy = [...itemsForBuy];
                newItemsForBuy = [newItemsForBuy.splice(j, 1)[0], ...newItemsForBuy];
                const expedition = {
                    portId: portPrices.portId,
                    items: [],
                    total: 0,
                    price: 0,
                    destination: port.coords,
                    road: port.road,
                    backRoad: port.backRoad,
                    profit: 0,
                };
                expedition.distance = expedition.road.length * 2;

                for (let i = 0; i < newItemsForBuy.length; i += 1) {
                    if (expedition.total === this.maxCap) {
                        break;
                    }
                    const itemNumber = newItemsForBuy[i];
                    const leftSpace = this.maxCap - expedition.total;
                    let amountOfItems = Math.floor(leftSpace / goodsAvailable[itemNumber].volume);
                    if (amountOfItems === 0) {
                        continue;
                    }
                    if (amountOfItems >= goodsAvailable[itemNumber].amount) {
                        amountOfItems = goodsAvailable[itemNumber].amount;
                    }
                    const possibleProfit = (expedition.price + (amountOfItems * goodsAvailable[itemNumber].price)) / (expedition.distance + 2);
                    if (expedition.profit > possibleProfit) {
                        continue;
                    }
                    expedition.items.push({ name: goodsAvailable[itemNumber].name, amount: amountOfItems });
                    expedition.profit = possibleProfit;
                    expedition.distance += 2;
                    expedition.total += amountOfItems * goodsAvailable[itemNumber].volume;
                    expedition.price += amountOfItems * goodsAvailable[itemNumber].price;
                }
                possibleExpeditions.push(expedition);
            }
            possibleExpeditions.sort((a, b) => b.profit - a.profit);
            this.expeditions.push(possibleExpeditions[0]);
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
            // Координаты в удобном формате
            port.coords = [port.y, port.x];
            // Копируем цены
            port.prices = this.prices.find((price) => price.portId === port.portId);
            // Путь
            port.backRoad = this.createPath(port.coords);
            // Переворачиваем путь
            port.road = [...port.backRoad].reverse().map((direction) => this.reversedDirection[direction]);
        });
    }

    // Сделать ход
    doAction() {
        // Если у нас есть действие сделать его
        if (this.actions.length) {
            this.turn += 1;
            let actionToDo = this.actions.splice(0, 1)[0];
            if (['W','E','N','S'].includes(actionToDo) && this.pirates) {
                actionToDo = this.changeActionFromPirates(actionToDo);
            }
            return actionToDo;
        }

        // Иначе создать новое действие
        if (this.isSamePos(this.currentPos, this.homePos)) {
            if (this.maxTurn - this.turn < this.stopGreedy) {
                this.createTwoBestExpeditions();
            } else {
                this.makeExpedition();
            }
        } else {
            this.goHome(this.currentPos);
        }

        return this.doAction();
    }

    // Меняем действие если мы в опасности
    changeActionFromPirates(actionToDo) {
        const nextPosition = [this.currentPos[0] + this.reversedMapMoves[actionToDo][0],
            this.currentPos[1] + this.reversedMapMoves[actionToDo][1]];

        if (!this.positionSafeFromPirates(nextPosition)) {
            if (!this.positionSafeFromPirates(this.currentPos)) {
                let possibleMoves = this.arrayOfMoves.map(i => [i[0] + this.currentPos[0], i[1] + this.currentPos[1]])
                    .filter(this.isValidPos.bind(this))
                    .filter(this.positionSafeFromPirates.bind(this))
                    .filter(this.isPositionAvailableForMove.bind(this))

                this.actions.splice(0, 0, actionToDo);
                // Двигаться в случайном направлении?
                const newPos = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
                const commandMove = this.mapMoves[[newPos[0] - this.currentPos[0], newPos[1] - this.currentPos[1]].join()]
                actionToDo = commandMove;
                this.actions.splice(0, 0, this.reversedDirection[commandMove]);
            } else {
                this.actions.splice(0, 0, actionToDo);
                return 'WAIT';
            }  
        }
        return actionToDo;
    }

    // Создать маршрут до домашнего порта
    createPath(fromCooridantes) {
        let currentPosition = this.pathMap[fromCooridantes[0]][fromCooridantes[1]];
        let positionCoordinates = fromCooridantes;
        const road = [];

        while (currentPosition.prev) {
            const move = [currentPosition.prev[0] - positionCoordinates[0], 
                currentPosition.prev[1] - positionCoordinates[1]];

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
        this.constructExpeditionsForEveryPort();
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
        this.sortExpeditions();
        let numOfExpedition = 0;
        let expedition = this.expeditions[numOfExpedition];
        while(expedition.road.length + expedition.items.length * 2 > this.maxTurn - this.turn) {
            numOfExpedition += 1;
            if (numOfExpedition >= this.expeditions.length) {
                return null
            }
            expedition = this.expeditions[numOfExpedition];
        }
        if (this.logger) {
            const expForLogs = expedition;
            console.log('\n');
            console.log('Turns: ', this.turn,'-',expForLogs.distance + this.turn, `(${expForLogs.distance})`);
            console.log('PortId: ', expForLogs.portId);
            console.log('Items: ', expForLogs.items.map(i => `${i.name}: ${i.amount}`).join(', '));
            console.log('Price: ', expForLogs.price);
            console.log('Profit: ', expForLogs.profit);
            console.log('Score: ', this.score + expForLogs.price);
        }
        return expedition;
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
