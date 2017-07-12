const PIXI = require("pixi.js");
const $ = require("jquery");
const seedrandom = require("seedrandom");
const alea = seedrandom.alea;
const extraFilters = require("pixi-extra-filters");
const GlowFilter = extraFilters.GlowFilter;
const pako = require("pako");
const msgpack = require("msgpack-lite");


const VISUALIZER_SIZE = 640;
const CELL_SIZE = 1;
export const PLAYER_COLORS = [0xFF704B, 0x9010B9, 0x005DD0, 0x00B553];
export const PLANET_COLOR = 0xb7b7b7;


let ASSET_ROOT = "dist/";

let BACKGROUND_IMAGES = [];
let PLANET_IMAGES = [];
let HALO_IMAGE = "";
let ATTACK_IMAGE = "";


export function setAssetRoot(path) {
    ASSET_ROOT = path;

    BACKGROUND_IMAGES = [
        ASSET_ROOT + require("../assets/backgrounds/Space001.png"),
        ASSET_ROOT + require("../assets/backgrounds/Space002.png"),
        ASSET_ROOT + require("../assets/backgrounds/Space003.png"),
        ASSET_ROOT + require("../assets/backgrounds/Space004.png"),
        ASSET_ROOT + require("../assets/backgrounds/Space005.png"),
    ];
    PLANET_IMAGES = [
        ASSET_ROOT + require("../assets/planets/p1.png"),
        ASSET_ROOT + require("../assets/planets/p2.png"),
        ASSET_ROOT + require("../assets/planets/p3.png"),
        ASSET_ROOT + require("../assets/planets/p4.png"),
    ];
    HALO_IMAGE = ASSET_ROOT + require("../assets/halo.png");
    ATTACK_IMAGE = ASSET_ROOT + require("../assets/attack.png");
}


setAssetRoot("dist/");


class FrameAnimation {
    constructor(frames, update, draw, finish) {
        this.frames = frames;
        this.update = update;
        this.draw = draw;
        this.finish = finish;
    }
}

export class HaliteVisualizer {
    constructor(replay) {
        this.replay = replay;
        this.frame = 0;
        this.substep = 0;
        this.application = new PIXI.Application(
            VISUALIZER_SIZE, 100 + VISUALIZER_SIZE * (this.replay.height / this.replay.width),
            {
                backgroundColor: 0x15223F,
            }
        );

        this.scale = VISUALIZER_SIZE / Math.max(replay.width, replay.height);
        this.starfield = PIXI.Sprite.fromImage(
            BACKGROUND_IMAGES[Math.floor(Math.random() * BACKGROUND_IMAGES.length)]);

        this.planetContainer = new PIXI.Container();
        this.planetOverlay = new PIXI.Graphics();
        this.shipContainer = new PIXI.Graphics();
        this.lights = new PIXI.Graphics();
        this.lights.blendMode = PIXI.BLEND_MODES.SCREEN;
        this.lights.filters = [new GlowFilter(15, 2, 1, 0xFF0000, 0.5)];
        this.container = new PIXI.Container();
        this.container.position.set(0, 100);

        this.planets = [];
        for (let i = 0; i < this.replay.planets.length; i++) {
            const planetBase = this.replay.planets[i];
            const planetSprite =
                PIXI.Sprite.fromImage(PLANET_IMAGES[i % PLANET_IMAGES.length]);
            const r = planetBase.r * CELL_SIZE * this.scale;
            planetSprite.width = planetSprite.height = 2 * r;
            planetSprite.anchor.x = 0.5;
            planetSprite.anchor.y = 0.5;
            planetSprite.position.x = this.scale * CELL_SIZE * (planetBase.x + 0.5);
            planetSprite.position.y = this.scale * CELL_SIZE * (planetBase.y + 0.5);

            planetSprite.interactive = true;
            planetSprite.buttonMode = true;
            planetSprite.on("pointerdown", () => {
                this.onSelect("planet", {
                    id: i,
                });
            });

            this.planets.push(planetSprite);
            this.planetContainer.addChild(planetSprite);
        }
        this.planetContainer.addChild(this.planetOverlay);

        let poi = new PIXI.Graphics();
        this.drawPOI(poi);
        let renderer = new PIXI.CanvasRenderer(VISUALIZER_SIZE, VISUALIZER_SIZE);
        let texture = renderer.generateTexture(poi);
        this.poi = PIXI.Sprite.from(texture);

        this.container.addChild(this.starfield, poi, this.planetContainer, this.shipContainer, this.lights);

        this.statsDisplay = new PIXI.Graphics();

        this.shipStrengthLabel = new PIXI.Text("Relative Fleet Strength");
        this.planetStrengthLabel = new PIXI.Text("Relative Territory");
        this.planetStrengthLabel.position.y = 50;

        this.application.stage.addChild(this.container);
        this.application.stage.addChild(this.statsDisplay);
        this.application.stage.addChild(this.shipStrengthLabel);
        this.application.stage.addChild(this.planetStrengthLabel);

        this.timer = null;

        this.animationQueue = [];

        this.onUpdate = function() {};
        this.onPlay = function() {};
        this.onPause = function() {};
        this.onEnd = function() {};
        this.onSelect = function() {};
        this.onDeselect = function() {};
    }

    get currentSubstep() {
        return this.replay.frames[this.frame][this.substep];
    }

    get currentStatistics() {
        let substep = this.currentSubstep;
        let planets = { "unowned": 0 };
        let ships = {};
        let total_ships = 0;

        for (let planet of Object.values(substep.planets)) {
            if (planet.owner !== null) {
                if (typeof planets[planet.owner] === "undefined") {
                    planets[planet.owner] = 0;
                }
                planets[planet.owner]++;
            }
            else {
                planets["unowned"]++;
            }
        }

        for (let ship of substep.ships) {
            if (typeof ships[ship.owner] === "undefined") {
                ships[ship.owner] = 0;
            }
            ships[ship.owner]++;
            total_ships++;
        }

        return {
            "planets": planets,
            "ships": ships,
            "total_ships": total_ships,
        };
    }

    attach(containerEl) {
        $(containerEl).append(this.application.view);

        document.body.addEventListener("keypress", (e) => {
            if (e.keyCode === 97) {
                this.pause();
                this.substep--;
                if (this.substep < 0) {
                    this.frame--;
                    if (this.frame < 0) {
                        this.frame = 0;
                    }
                    this.substep = this.replay.frames[this.frame].length - 1;
                }
            }
            else if (e.keyCode === 100) {
                this.pause();
                this.substep++;
                if (this.substep >= this.replay.frames[this.frame].length) {
                    this.substep = 0;
                    this.frame++;
                }

                if (this.frame >= this.replay.frames.length) {
                    this.frame = this.replay.frames.length - 1;
                    this.substep = this.replay.frames[this.frame].length - 1;
                }
            }
            else if (e.keyCode === 32) {
                if (this.timer) this.pause();
                else this.play();
            }
            else {
                console.log(e);
                return;
            }
            this.update();
        });

        this.application.ticker.add((dt) => {
            this.draw(dt);
        });
        this.draw();
    }

    play() {
        if (this.timer) return;

        this.timer = window.setInterval(() => {
            for (let i = 0; i < 8; i++) {
                this.substep++;
                if (this.substep >= this.replay.frames[this.frame].length) {
                    this.substep = 0;
                    this.frame++;
                }

                if (this.frame >= this.replay.frames.length) {
                    this.pause();
                    this.frame = this.replay.frames.length - 1;
                    this.substep = this.replay.frames[this.frame].length - 1;
                    this.onEnd();
                    break;
                }

                this.update();
            }

            this.onUpdate();
        }, 1000/20);

        this.onPlay();
    }

    pause() {
        if (!this.timer) return;

        window.clearInterval(this.timer);
        this.timer = null;
        this.onPause();
    }

    /**
     *
     * @param container
     * @param x
     * @param y
     * @param color
     * @param health_factor
     */
    drawCell(container, x, y, color, health_factor, glow=false) {
        const side = CELL_SIZE * this.scale;
        x = x * side;
        y = y * side;
        container.lineStyle(0);
        // Hide the background
        container.beginFill(0x000000);
        container.drawRect(x, y, side, side);
        container.endFill();
        // Draw the actual cell
        container.beginFill(color, 0.5);
        container.drawRect(x, y, side, side);
        container.endFill();
        container.beginFill(color, 1);
        container.drawRect(
            x + health_factor * side,
            y + health_factor * side,
            (1 - 2*health_factor) * side,
            (1 - 2*health_factor) * side);
        container.endFill();

        if (glow) {
            container.beginFill(color, 0.1);
            container.drawCircle(x + 0.5 * side, y + 0.5 * side, this.replay.constants.WEAPON_RADIUS * side);
            container.endFill();
        }
    }

    drawPOI(graphics) {
        const side = CELL_SIZE * this.scale;
        for (let poi of this.replay.poi) {
            if (poi.type === "orbit") {
                graphics.beginFill(0, 0);
                graphics.lineStyle(1, 0xFFFFFF, 0.2);
                const x = side * poi.x;
                const y = side * poi.y;
                const a = side * poi.x_axis;
                const b = side * poi.y_axis;
                graphics.drawEllipse(x, y, a, b);
                graphics.endFill();
            }
            else {
                console.log(poi);
            }
        }
    }

    drawPlanet(planet) {
        let planetBase = this.replay.planets[planet.id];

        const side = CELL_SIZE * this.scale;
        const color = planet.owner === null ? PLANET_COLOR : PLAYER_COLORS[planet.owner];

        const center_x = side * planetBase.x;
        const center_y = side * (planetBase.y + 0.5);

        const health_factor = planet.health / planetBase.health;
        const health_bar = health_factor * side * (planetBase.r - 1);

        this.planets[planet.id].tint = color;
        this.planets[planet.id].alpha = 1.0;
        this.planets[planet.id].visible = true;
        this.planets[planet.id].interactive = true;
        this.planets[planet.id].buttonMode = true;

        if (planet.health === 0) {
            this.planets[planet.id].alpha = 0;
            this.planets[planet.id].visible = false;
            this.planets[planet.id].interactive = false;
            this.planets[planet.id].buttonMode = false;
        }
        else if (health_factor < 0.25) {
            this.planets[planet.id].alpha = 0.7;
        }

        this.planetOverlay.beginFill(0x990000);
        this.planetOverlay.lineStyle(0, 0x000000);
        this.planetOverlay.drawRect(center_x, center_y - health_bar, side, 2 * health_bar);
        this.planetOverlay.endFill();
    }

    drawShip(ship) {
        const side = CELL_SIZE * this.scale;
        const max_ship_health = this.replay.constants.MAX_SHIP_HEALTH;
        const health_factor = 0.1 + 0.3 * (max_ship_health - ship.health) / max_ship_health;

        const x = side * ship.x;
        const y = side * ship.y;

        this.drawCell(this.shipContainer, ship.x, ship.y, PLAYER_COLORS[ship.owner], health_factor, ship.cooldown === 0);

        if (this.frame > 0) {
            let move = this.replay.moves[this.frame-1][ship.owner][0][ship.id];
            if (move && move.type === "thrust" && move.magnitude > this.replay.constants.DRAG) {
                // Draw thrust trail
                const magnitude = move.magnitude / this.replay.constants.MAX_ACCELERATION;
                this.shipContainer.beginFill(0xFF0000, 0.5 + 0.3 * magnitude);
                const cx = x + 0.5 * side;
                const cy = y + 0.5 * side;
                const angle = (move.angle + 180) * Math.PI / 180;
                const deltaAngle = Math.PI / 10 + Math.PI / 10 * magnitude;
                this.shipContainer.moveTo(cx, cy);
                this.shipContainer.arc(cx, cy, (2 + 2 * magnitude) * side, angle - deltaAngle, angle + deltaAngle);
                this.shipContainer.endFill();
            }
        }

        const dock_turns = this.replay.constants.DOCK_TURNS;

        if (ship.docking.status !== "undocked") {
            let progress = ship.docking.status === "docked" ? dock_turns : dock_turns - ship.docking.turns_left;
            if (ship.docking.status === "undocking") {
                progress = ship.docking.turns_left / dock_turns;
            }
            else {
                progress /= dock_turns;
            }

            const planetId = ship.docking.planet_id;
            const planetBase = this.replay.planets[planetId];

            const planetX = side * (planetBase.x + 0.5);
            const planetY = side * (planetBase.y + 0.5);

            const cx = x + 0.5*side;
            const cy = y + 0.5*side;

            const dx = planetX - cx;
            const dy = planetY - cy;

            this.shipContainer.beginFill(PLAYER_COLORS[ship.owner]);
            this.shipContainer.lineStyle(2, 0xFFFFFF, 1);
            this.shipContainer.moveTo(cx, cy);
            this.shipContainer.lineTo(cx + progress*dx, cy + progress*dy);
            this.shipContainer.endFill();
        }
    }

    update() {
        if (this.currentSubstep.events) {
            for (let event of this.currentSubstep.events) {
                if (event.event === "destroyed") {
                    let draw = (frame) => {
                        const width = CELL_SIZE * this.scale;
                        const height = CELL_SIZE * this.scale;

                        const x = width * event.x;
                        const y = width * event.y;

                        this.lights.beginFill(0xFFA500, frame / 24);
                        this.lights.lineStyle(0);
                        this.lights.drawRect(x, y, width, height);
                        this.lights.endFill();
                    };
                    if (event.radius > 0) {
                        let r = event.radius;
                        draw = (frame) => {
                            const side = CELL_SIZE * this.scale;
                            this.planetOverlay.lineStyle(0);
                            for (let dx = -r; dx <= r; dx++) {
                                for (let dy = -r; dy <= r; dy++) {
                                    if (dx*dx + dy*dy <= r*r) {
                                        const distance = (48 - frame) / 24;
                                        const x = Math.floor(side * (distance * dx + event.x));
                                        const y = Math.floor(side * (distance * dy + event.y));

                                        this.lights.beginFill(0xFFA500, (frame / 48) * (1 / (1 + distance + 1 / (1 + dx*dx + dy*dy))));
                                        this.lights.drawRect(x, y, side, side);
                                        this.lights.endFill();
                                    }
                                }
                            }
                        };
                    }

                    this.animationQueue.push(new FrameAnimation(
                        48, () => {}, draw, () => {}
                    ));
                }
                else if (event.event === "attack") {
                    const side = CELL_SIZE * this.scale;

                    const x = side * (event.x + 0.5);
                    const y = side * (event.y + 0.5);

                    let attackSprite = PIXI.Sprite.fromImage(ATTACK_IMAGE);
                    attackSprite.anchor.x = 0.5;
                    attackSprite.anchor.y = 0.5;
                    attackSprite.position.x = x;
                    attackSprite.position.y = y;
                    attackSprite.width = 2 * side * this.replay.constants.WEAPON_RADIUS;
                    attackSprite.height = 2 * side * this.replay.constants.WEAPON_RADIUS;
                    attackSprite.tint = PLAYER_COLORS[event.entity.owner];
                    this.container.addChild(attackSprite);

                    this.animationQueue.push(new FrameAnimation(
                        24,
                        () => {
                        },
                        (frame) => {
                            attackSprite.alpha = 0.5 * frame / 24;
                        },
                        () => {
                            this.container.removeChild(attackSprite);
                        }
                    ));
                }
                else if (event.event === "spawned") {
                    this.animationQueue.push(new FrameAnimation(
                        24,
                        () => {
                        },
                        (frame) => {
                            const side = CELL_SIZE * this.scale;
                            const planetX = side * (event.planet_x + 0.5);
                            const planetY = side * (event.planet_y + 0.5);
                            const ship_x = side * (event.x + 0.5);
                            const ship_y = side * (event.y + 0.5);
                            this.shipContainer.lineStyle(3, PLAYER_COLORS[event.entity.owner], 0.5 * frame / 24);
                            this.shipContainer.moveTo(planetX, planetY);
                            this.shipContainer.lineTo(ship_x, ship_y);
                            this.shipContainer.endFill();
                        },
                        () => {

                        }
                    ));
                }
                else {
                    console.log(event);
                }
            }
        }
    }

    draw(dt=0) {
        this.planetOverlay.clear();
        this.shipContainer.clear();
        this.lights.clear();

        for (let planet of Object.values(this.currentSubstep.planets)) {
            this.drawPlanet(planet);
        }

        // Handle dead planets
        for (let planet of this.replay.planets) {
            if (typeof this.currentSubstep.planets[planet.id] === "undefined") {
                this.drawPlanet({ id: planet.id, owner: null, health: 0 });
            }
        }

        for (let ship of this.currentSubstep.ships) {
            this.drawShip(ship);
        }

        this.drawStats();

        // dt comes from Pixi ticker, and the unit is essentially frames
        let queue = this.animationQueue;
        this.animationQueue = [];
        for (let anim of queue) {
            if (anim.frames > 0) {
                anim.draw(anim.frames);
                anim.frames -= dt;
                this.animationQueue.push(anim);
            }
            else {
                anim.finish();
            }
        }
    }

    drawStats() {
        let stats = this.currentStatistics;

        let x = 0;
        for (let player = 0; player < this.replay.num_players; player++) {
            const width = VISUALIZER_SIZE * (stats.ships[player] || 0) / stats.total_ships;
            this.statsDisplay.beginFill(PLAYER_COLORS[player]);
            this.statsDisplay.drawRect(x, 0, width, 40);
            this.statsDisplay.endFill();
            x += width;
        }
        this.statsDisplay.beginFill(0x000000);
        this.statsDisplay.drawRect(0, 40, VISUALIZER_SIZE, 10);
        this.statsDisplay.endFill();
        x = 0;
        for (let player = 0; player < this.replay.num_players; player++) {
            const width = VISUALIZER_SIZE * (stats.planets[player] || 0) / this.replay.planets.length;
            this.statsDisplay.beginFill(PLAYER_COLORS[player]);
            this.statsDisplay.drawRect(x, 50, width, 40);
            this.statsDisplay.endFill();
            x += width;
        }
        const width = VISUALIZER_SIZE * (stats.planets["unowned"] || 0) / this.replay.planets.length;
        this.statsDisplay.beginFill(PLANET_COLOR);
        this.statsDisplay.drawRect(x, 50, width, 40);
        this.statsDisplay.endFill();
        this.statsDisplay.drawRect(0, 90, VISUALIZER_SIZE, 10);
    }

    isPlaying() {
        return this.timer !== null;
    }
}

const parseWorker = require("worker-loader?inline!./parseWorker");

export function parseReplay(buffer) {
    return new Promise((resolve, reject) => {
        try {
            const startTime = Date.now();
            const worker = new parseWorker();
            worker.onmessage = function (e) {
                const inflated = e.data;
                const inflatedTime = Date.now();
                const replay = msgpack.decode(new Uint8Array(inflated));
                const finishTime = Date.now();
                console.info(`Decoded compressed replay in ${finishTime - startTime}ms, inflating took ${inflatedTime - startTime}ms, decoding took ${finishTime - inflatedTime}ms.`);
                resolve(replay);
            };
            worker.postMessage(buffer, [buffer]);
            if (buffer.byteLength) {
                console.warn("Transferrables not supported, could not decode without copying data!");
            }
        }
        catch (e) {
            console.error(e);
            resolve(msgpack.decode(buffer));
        }
    });
}